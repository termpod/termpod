import Combine
import Foundation

/// Manages multiple transport connections and routes data through the best one.
///
/// Priority: local WebSocket > WebRTC > relay.
/// The relay always stays connected for signaling and as a fallback.
/// Input is sent through the best transport only.
/// Output is filtered by active transport once the session is live,
/// but relay data is always accepted during initial connection (scrollback).
@MainActor
final class ConnectionManager: ObservableObject {

    @Published var activeTransport: TransportType = .relay
    @Published var state: RelayClient.ConnectionState = .disconnected
    @Published var connectedViewers: Int = 0
    @Published var ptySize: (cols: Int, rows: Int) = (80, 24)
    var isBackgrounded = false
    var sessionName: String = ""
    weak var terminalView: RemoteTerminalView?
    private var lastBackgroundNotification: Date = .distantPast

    var onTerminalData: ((Data) -> Void)?
    var onResize: ((Int, Int) -> Void)?
    var onSessionClosed: (() -> Void)?

    /// Keyed completion handlers for request/response control messages.
    /// Each request registers a handler with a unique ID; the response removes it.
    private var sessionCreatedHandlers: [String: (_ requestId: String, _ sessionId: String, _ name: String, _ cwd: String, _ ptyCols: Int, _ ptyRows: Int) -> Void] = [:]
    private var sessionsListHandlers: [String: ([[String: Any]]) -> Void] = [:]

    func addSessionCreatedHandler(id: String, handler: @escaping (_ requestId: String, _ sessionId: String, _ name: String, _ cwd: String, _ ptyCols: Int, _ ptyRows: Int) -> Void) {
        sessionCreatedHandlers[id] = handler
    }

    func removeSessionCreatedHandler(id: String) {
        sessionCreatedHandlers.removeValue(forKey: id)
    }

    func addSessionsListHandler(id: String, handler: @escaping ([[String: Any]]) -> Void) {
        sessionsListHandlers[id] = handler
    }

    func removeSessionsListHandler(id: String) {
        sessionsListHandlers.removeValue(forKey: id)
    }

    let relay: RelayClient
    private let localTransport: LocalTransport
    private let sessionId: String
    private var cancellables: Set<AnyCancellable> = []

    /// Reference to the device-level transport manager for WebRTC + local WS multiplexing.
    weak var deviceTransport: DeviceTransportManager?

    /// Whether this session is subscribed to WebRTC session data via device transport.
    private var webrtcSubscribed = false

    /// Circular buffer of recent terminal output so we can replay it
    /// when a new terminal view is attached (e.g. after navigation).
    private var scrollbackBuffer = Data()
    private let maxScrollbackSize = 256 * 1024

    init(sessionId: String) {
        self.sessionId = sessionId
        self.relay = RelayClient()
        self.localTransport = LocalTransport(sessionId: sessionId)
        setupCallbacks()
        observeTransportOverride()
    }

    /// Wire up the device transport for local WS and WebRTC multiplexing.
    ///
    /// Both local WS and WebRTC use device-level multiplexed connections:
    /// - Local WS: [channel][sid_len][sid][payload] (channels 0x00/0x01/0x02)
    /// - WebRTC: [channel][sid_len][sid][payload] (channels 0x10/0x11)
    func configureLocalTransport(with transport: DeviceTransportManager) {
        localTransport.deviceTransport = transport

        // Subscribe to WebRTC session data through device transport
        transport.subscribeWebRTCSession(
            sessionId: sessionId,
            onData: { [weak self] data in
                guard let self, self.shouldAcceptData(from: .webrtc) else { return }
                self.bufferAndDeliver(data)
            },
            onResize: { [weak self] cols, rows in
                self?.ptySize = (cols, rows)
                self?.onResize?(cols, rows)
            }
        )
        webrtcSubscribed = true

        // Observe device transport changes to update active transport
        transport.objectWillChange.sink { [weak self] _ in
            Task { @MainActor in
                self?.updateActiveTransport()
            }
        }.store(in: &cancellables)

        // If device transport already has an active P2P connection, use it immediately
        updateActiveTransport()
    }

    // MARK: - Connection

    func connect(wsURL: URL, token: String? = nil) {
        relay.connect(wsURL: wsURL, token: token)
        localTransport.startDiscovery()
    }

    func disconnect() {
        relay.disconnect()
        localTransport.disconnect()
        if webrtcSubscribed {
            deviceTransport?.unsubscribeWebRTCSession(sessionId: sessionId)
            webrtcSubscribed = false
        }
        activeTransport = .relay
    }

    /// Verify session relay is alive after returning from background.
    func reconnectIfNeeded() {
        relay.reconnectIfNeeded()
    }

    // MARK: - Sending (through best transport only)

    /// Whether device-level WebRTC is connected and available for this session.
    private var isWebRTCAvailable: Bool {
        deviceTransport?.isWebRTCConnected ?? false
    }

    func sendInput(_ data: Data) {
        let override = transportOverride

        if override != .auto, let forced = override.transportType, isTransportAvailable(forced) {
            sendInputVia(forced, data: data)
            return
        }

        if localTransport.isConnected {
            localTransport.sendInput(data)
        } else if isWebRTCAvailable {
            deviceTransport?.sendWebRTCSessionInput(sessionId: sessionId, data: data)
        } else {
            relay.sendInput(data)
        }
    }

    private func sendInputVia(_ transport: TransportType, data: Data) {
        switch transport {
        case .local:
            localTransport.sendInput(data)
        case .webrtc:
            deviceTransport?.sendWebRTCSessionInput(sessionId: sessionId, data: data)
        case .relay:
            relay.sendInput(data)
        }
    }

    /// Track the last size this mobile client requested so we can
    /// re-send it when the active transport changes.
    private var lastRequestedSize: (cols: Int, rows: Int)?

    func sendResize(cols: Int, rows: Int) {
        lastRequestedSize = (cols, rows)
        let override = transportOverride

        if override != .auto, let forced = override.transportType, isTransportAvailable(forced) {
            sendResizeVia(forced, cols: cols, rows: rows)
            return
        }

        if localTransport.isConnected {
            localTransport.sendResize(cols: cols, rows: rows)
        } else if isWebRTCAvailable {
            deviceTransport?.sendWebRTCSessionResize(sessionId: sessionId, cols: cols, rows: rows)
        } else {
            relay.sendResize(cols: cols, rows: rows)
        }
    }

    private func sendResizeVia(_ transport: TransportType, cols: Int, rows: Int) {
        switch transport {
        case .local:
            localTransport.sendResize(cols: cols, rows: rows)
        case .webrtc:
            deviceTransport?.sendWebRTCSessionResize(sessionId: sessionId, cols: cols, rows: rows)
        case .relay:
            relay.sendResize(cols: cols, rows: rows)
        }
    }

    /// Replay buffered terminal output to the current `onTerminalData` callback.
    func replayScrollback() {
        guard !scrollbackBuffer.isEmpty else { return }
        onTerminalData?(scrollbackBuffer)
    }

    /// Briefly change cols by -1 then restore, forcing a SIGWINCH on the
    /// desktop so the shell redraws. Used after attaching a new terminal view.
    func sendNudgeResize() {
        guard let size = lastRequestedSize, size.cols > 1 else { return }
        sendResize(cols: size.cols - 1, rows: size.rows)
        Task {
            try? await Task.sleep(for: .milliseconds(50))
            self.sendResize(cols: size.cols, rows: size.rows)
        }
    }

    /// Returns true if a P2P transport (local or WebRTC) is available for control messages.
    var hasP2PTransport: Bool {
        localTransport.isConnected || (deviceTransport?.isWebRTCConnected ?? false)
    }

    func sendListSessions() {
        let msg: [String: Any] = ["type": "list_sessions"]

        if localTransport.isConnected {
            if let data = try? JSONSerialization.data(withJSONObject: msg),
               let str = String(data: data, encoding: .utf8) {
                localTransport.sendControlMessage(str)
            }
        } else if let webrtc = deviceTransport?.webrtcTransportForControl, webrtc.isConnected {
            webrtc.sendControlMessage(msg)
        }
    }

    func sendDeleteSession(sessionId: String) {
        let msg: [String: Any] = [
            "type": "delete_session",
            "sessionId": sessionId,
        ]

        if localTransport.isConnected {
            if let data = try? JSONSerialization.data(withJSONObject: msg),
               let str = String(data: data, encoding: .utf8) {
                localTransport.sendControlMessage(str)
            }
        } else if let webrtc = deviceTransport?.webrtcTransportForControl, webrtc.isConnected {
            webrtc.sendControlMessage(msg)
        } else {
            relay.sendSignaling(msg)
        }
    }

    func sendCreateSessionRequest(requestId: String) {
        let msg: [String: Any] = [
            "type": "create_session_request",
            "requestId": requestId,
        ]

        if localTransport.isConnected {
            if let data = try? JSONSerialization.data(withJSONObject: msg),
               let str = String(data: data, encoding: .utf8) {
                localTransport.sendControlMessage(str)
            }
        } else if let webrtc = deviceTransport?.webrtcTransportForControl, webrtc.isConnected {
            webrtc.sendControlMessage(msg)
        } else {
            relay.sendSignaling(msg)
        }
    }

    // MARK: - Private

    /// Re-send mobile dimensions after a short delay, guarding against
    /// the transport having changed during the wait.
    private func resendSizeAfterDelay() {
        guard let size = lastRequestedSize else { return }
        let transportBefore = activeTransport

        Task {
            try? await Task.sleep(for: .milliseconds(150))
            guard self.activeTransport == transportBefore else { return }
            self.sendResize(cols: size.cols, rows: size.rows)
        }
    }

    private func dispatchSessionCreated(_ requestId: String, _ sessionId: String, _ name: String, _ cwd: String, _ ptyCols: Int, _ ptyRows: Int) {
        // Dispatch to matching handler (keyed by requestId)
        if let handler = sessionCreatedHandlers.removeValue(forKey: requestId) {
            handler(requestId, sessionId, name, cwd, ptyCols, ptyRows)
        }
    }

    private func dispatchSessionsList(_ sessions: [[String: Any]]) {
        // Dispatch to ALL waiting handlers (list_sessions has no request ID)
        let handlers = sessionsListHandlers
        sessionsListHandlers.removeAll()
        for (_, handler) in handlers {
            handler(sessions)
        }
    }

    /// Read the user's transport override from UserDefaults (matches @AppStorage key).
    private var transportOverride: TransportOverride {
        guard let raw = UserDefaults.standard.string(forKey: "transport.override"),
              let override = TransportOverride(rawValue: raw)
        else { return .auto }
        return override
    }

    private func updateActiveTransport() {
        let override = transportOverride

        if override != .auto, let forced = override.transportType {
            if isTransportAvailable(forced) {
                activeTransport = forced
                return
            }
            // Forced transport not available — fall through to auto
        }

        if localTransport.isConnected {
            activeTransport = .local
        } else if isWebRTCAvailable {
            activeTransport = .webrtc
        } else {
            activeTransport = .relay
        }
    }

    private func isTransportAvailable(_ transport: TransportType) -> Bool {
        switch transport {
        case .local: return localTransport.isConnected
        case .webrtc: return isWebRTCAvailable
        case .relay: return true
        }
    }

    /// Filter incoming data by transport. When an override is set, only accept
    /// data from the forced transport (so we can verify each mode end-to-end).
    /// In auto mode, accept from the best available transport.
    private func shouldAcceptData(from type: TransportType) -> Bool {
        // Before session is fully live, always accept (scrollback)
        if state != .live {
            return true
        }

        let override = transportOverride

        if override != .auto, let forced = override.transportType {
            return type == forced
        }

        return type == activeTransport
    }

    private func bufferAndDeliver(_ data: Data) {
        scrollbackBuffer.append(data)
        if scrollbackBuffer.count > maxScrollbackSize {
            scrollbackBuffer = Data(scrollbackBuffer.suffix(maxScrollbackSize))
        }
        onTerminalData?(data)
    }

    private func observeTransportOverride() {
        NotificationCenter.default.publisher(for: .transportOverrideChanged)
            .sink { [weak self] _ in
                Task { @MainActor in
                    self?.updateActiveTransport()
                    self?.relay.sendTransportPreference()
                }
            }
            .store(in: &cancellables)
    }

    private func setupCallbacks() {
        // Relay output — accepted during scrollback phase, filtered once live
        relay.onTerminalData = { [weak self] data in
            guard let self, self.shouldAcceptData(from: .relay) else { return }
            self.bufferAndDeliver(data)
            if self.isBackgrounded {
                let now = Date()
                if now.timeIntervalSince(self.lastBackgroundNotification) > 5 {
                    self.lastBackgroundNotification = now
                    NotificationService.shared.notifyBackgroundOutput(
                        sessionName: self.sessionName,
                        sessionId: self.sessionId
                    )
                }
            }
        }

        relay.onResize = { [weak self] cols, rows in
            self?.ptySize = (cols, rows)
            self?.onResize?(cols, rows)
        }

        relay.onSessionCreated = { [weak self] requestId, sessionId, name, cwd, ptyCols, ptyRows in
            self?.dispatchSessionCreated(requestId, sessionId, name, cwd, ptyCols, ptyRows)
        }

        relay.onSessionClosed = { [weak self] in
            self?.onSessionClosed?()
        }

        // Forward WebRTC signaling from relay — only when device-level
        // transport isn't handling WebRTC (avoids duplicate connections).
        relay.onSignaling = { [weak self] json in
            guard let self, self.deviceTransport == nil else { return }
            // No per-session WebRTC — device-level handles it
        }

        // Local transport callbacks — accepted when local is active
        localTransport.onTerminalData = { [weak self] data in
            guard let self, self.shouldAcceptData(from: .local) else { return }
            self.bufferAndDeliver(data)
        }

        localTransport.onResize = { [weak self] cols, rows in
            self?.ptySize = (cols, rows)
            self?.onResize?(cols, rows)
        }

        localTransport.onSessionCreated = { [weak self] requestId, sessionId, name, cwd, ptyCols, ptyRows in
            self?.dispatchSessionCreated(requestId, sessionId, name, cwd, ptyCols, ptyRows)
        }

        localTransport.onSessionsList = { [weak self] sessions in
            self?.dispatchSessionsList(sessions)
        }

        localTransport.onSessionClosed = { [weak self] in
            self?.onSessionClosed?()
        }

        localTransport.onConnected = { [weak self] in
            guard let self else { return }
            self.updateActiveTransport()
            self.resendSizeAfterDelay()
        }

        localTransport.onDisconnected = { [weak self] in
            self?.updateActiveTransport()
        }

        // Reconnect session relay when the network interface changes (WiFi ↔ cellular)
        NotificationCenter.default.publisher(for: .networkInterfaceChanged)
            .sink { [weak self] _ in
                self?.relay.handleNetworkChange()
            }
            .store(in: &cancellables)

        // Propagate relay state changes to this object
        relay.objectWillChange.sink { [weak self] _ in
            guard let self else { return }

            Task { @MainActor in
                let previousState = self.state
                self.state = self.relay.state
                self.connectedViewers = self.relay.connectedViewers
                self.ptySize = self.relay.ptySize
                self.objectWillChange.send()

                // When session becomes live, re-send mobile dimensions so the
                // PTY redraws at the correct size after the desktop's nudge-resize.
                if previousState != .live && self.relay.state == .live {
                    self.resendSizeAfterDelay()
                }
            }
        }.store(in: &cancellables)
    }
}
