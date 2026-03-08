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
    private let webrtcTransport: WebRTCTransport
    private let sessionId: String
    private var cancellables: Set<AnyCancellable> = []

    /// Reference to the device-level transport manager for WebRTC registration.
    weak var deviceTransport: DeviceTransportManager?

    /// Circular buffer of recent terminal output so we can replay it
    /// when a new terminal view is attached (e.g. after navigation).
    private var scrollbackBuffer = Data()
    private let maxScrollbackSize = 256 * 1024

    init(sessionId: String) {
        self.sessionId = sessionId
        self.relay = RelayClient()
        self.localTransport = LocalTransport(sessionId: sessionId)
        self.webrtcTransport = WebRTCTransport(clientId: UUID().uuidString)
        setupCallbacks()
    }

    // MARK: - Connection

    func connect(wsURL: URL, token: String? = nil) {
        relay.connect(wsURL: wsURL, token: token)
        localTransport.startDiscovery()
    }

    func disconnect() {
        deviceTransport?.unregisterWebRTC(webrtcTransport)
        relay.disconnect()
        localTransport.disconnect()
        webrtcTransport.disconnect()
        activeTransport = .relay
    }

    // MARK: - Sending (through best transport only)

    func sendInput(_ data: Data) {
        let transport = bestTransport
        transport.sendInput(data)

        // If a P2P transport was selected but disconnected between bestTransport
        // and sendInput, also send through relay as a safety net.
        if transport.transportType != .relay && !transport.isConnected {
            relay.sendInput(data)
        }
    }

    /// Track the last size this mobile client requested so we can
    /// re-send it when the active transport changes.
    private var lastRequestedSize: (cols: Int, rows: Int)?

    func sendResize(cols: Int, rows: Int) {
        lastRequestedSize = (cols, rows)
        let transport = bestTransport
        transport.sendResize(cols: cols, rows: rows)

        if transport.transportType != .relay && !transport.isConnected {
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
        let transport = bestTransport
        transport.sendResize(cols: size.cols - 1, rows: size.rows)
        Task {
            try? await Task.sleep(for: .milliseconds(50))
            transport.sendResize(cols: size.cols, rows: size.rows)
        }
    }

    /// Returns true if a P2P transport (local or WebRTC) is available for control messages.
    var hasP2PTransport: Bool {
        localTransport.isConnected || webrtcTransport.isConnected
    }

    func sendListSessions() {
        let msg: [String: Any] = ["type": "list_sessions"]

        if localTransport.isConnected {
            if let data = try? JSONSerialization.data(withJSONObject: msg),
               let str = String(data: data, encoding: .utf8) {
                localTransport.sendControlMessage(str)
            }
        } else if webrtcTransport.isConnected {
            webrtcTransport.sendControlMessage(msg)
        }
    }

    func sendDeleteSession(sessionId: String) {
        let msg: [String: Any] = [
            "type": "delete_session",
            "sessionId": sessionId,
        ]

        guard let data = try? JSONSerialization.data(withJSONObject: msg),
              let str = String(data: data, encoding: .utf8)
        else { return }

        if localTransport.isConnected {
            localTransport.sendControlMessage(str)
        } else if webrtcTransport.isConnected {
            webrtcTransport.sendControlMessage(msg)
        } else {
            relay.sendSignaling(msg)
        }
    }

    func sendCreateSessionRequest(requestId: String) {
        let msg: [String: Any] = [
            "type": "create_session_request",
            "requestId": requestId,
        ]

        guard let data = try? JSONSerialization.data(withJSONObject: msg),
              let str = String(data: data, encoding: .utf8)
        else { return }

        if localTransport.isConnected {
            localTransport.sendControlMessage(str)
        } else if webrtcTransport.isConnected {
            webrtcTransport.sendControlMessage(msg)
        } else {
            relay.sendSignaling(msg)
        }
    }

    // MARK: - Private

    private var bestTransport: Transport {
        if localTransport.isConnected { return localTransport }
        if webrtcTransport.isConnected { return webrtcTransport }
        return relay
    }

    /// Re-send mobile dimensions after a short delay, guarding against
    /// the transport having changed during the wait.
    private func resendSizeAfterDelay() {
        guard let size = lastRequestedSize else { return }
        let transportBefore = activeTransport

        Task {
            try? await Task.sleep(for: .milliseconds(150))
            guard self.activeTransport == transportBefore else { return }
            self.bestTransport.sendResize(cols: size.cols, rows: size.rows)
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

    private func updateActiveTransport() {
        if localTransport.isConnected {
            activeTransport = .local
        } else if webrtcTransport.isConnected {
            activeTransport = .webrtc
        } else {
            activeTransport = .relay
        }
    }

    /// During initial connection (connecting/loadingScrollback/connected), accept
    /// relay data unconditionally — it's the only source of scrollback history.
    /// Once the session is live, only accept data from the active transport.
    private func shouldAcceptData(from type: TransportType) -> Bool {
        // Before session is fully live, always accept relay data (scrollback)
        if type == .relay && state != .live {
            return true
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

        // Forward WebRTC signaling from relay (always needed)
        relay.onSignaling = { [weak self] json in
            self?.webrtcTransport.handleSignaling(json)
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

        // WebRTC transport callbacks — accepted when WebRTC is active
        webrtcTransport.onTerminalData = { [weak self] data in
            guard let self, self.shouldAcceptData(from: .webrtc) else { return }
            self.bufferAndDeliver(data)
        }

        webrtcTransport.onResize = { [weak self] cols, rows in
            self?.ptySize = (cols, rows)
            self?.onResize?(cols, rows)
        }

        webrtcTransport.onConnected = { [weak self] in
            guard let self else { return }
            self.updateActiveTransport()
            self.resendSizeAfterDelay()
            self.deviceTransport?.registerWebRTC(self.webrtcTransport)
        }

        webrtcTransport.onDisconnected = { [weak self] in
            guard let self else { return }
            self.deviceTransport?.unregisterWebRTC(self.webrtcTransport)
            self.updateActiveTransport()
        }

        webrtcTransport.onControlMessage = { [weak self] json in
            guard let type = json["type"] as? String else { return }

            switch type {
            case "session_created":
                if let requestId = json["requestId"] as? String,
                   let sessionId = json["sessionId"] as? String,
                   let name = json["name"] as? String,
                   let cwd = json["cwd"] as? String,
                   let ptyCols = json["ptyCols"] as? Int,
                   let ptyRows = json["ptyRows"] as? Int {
                    self?.dispatchSessionCreated(requestId, sessionId, name, cwd, ptyCols, ptyRows)
                }
            case "sessions_list":
                if let sessions = json["sessions"] as? [[String: Any]] {
                    self?.dispatchSessionsList(sessions)
                }
            case "session_closed", "session_ended":
                self?.onSessionClosed?()
            default:
                break
            }
        }

        webrtcTransport.sendSignaling = { [weak self] msg in
            self?.relay.sendSignaling(msg)
        }

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
