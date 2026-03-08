import Combine
import Foundation
import Network
import UIKit

extension Notification.Name {
    /// Posted when the network interface changes (WiFi ↔ cellular).
    /// Session-level relays should reconnect immediately.
    static let networkInterfaceChanged = Notification.Name("networkInterfaceChanged")
}

/// Session info returned by the device transport layer.
struct DeviceSessionInfo: Identifiable, Equatable {
    let id: String
    let name: String
    let cwd: String
    let processName: String?
    let ptyCols: Int
    let ptyRows: Int
}

/// Manages a persistent device-level connection to the desktop.
///
/// Handles three transport layers with failover:
/// 1. Local WebSocket (Bonjour) — lowest latency, LAN only
/// 2. WebRTC DataChannel — P2P, cross-network (requires relay for signaling)
/// 3. Device WebSocket (relay) — always available fallback
///
/// Used for control messages (list/create/delete sessions, signaling).
/// Lives in AppState and persists across all screen navigation.
@MainActor
final class DeviceTransportManager: ObservableObject {

    @Published var activeTransport: TransportType = .relay
    @Published var sessions: [DeviceSessionInfo] = []
    @Published var isConnected = false
    @Published var isConnecting = false
    @Published var webrtcMode: WebRTCConnectionMode?
    @Published var debugLog: [String] = []

    private func log(_ message: String) {
        let entry = "\(Self.logFormatter.string(from: Date())) \(message)"
        print("[DeviceTransport] \(message)")
        debugLog.append(entry)
        if debugLog.count > 100 { debugLog.removeFirst() }
    }

    private static let logFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss"
        return f
    }()

    /// Keyed completion handlers for request/response patterns.
    private var sessionCreatedHandlers: [String: (_ requestId: String, _ sessionId: String, _ name: String, _ cwd: String, _ ptyCols: Int, _ ptyRows: Int) -> Void] = [:]
    private var sessionsListHandlers: [String: ([DeviceSessionInfo]) -> Void] = [:]

    /// Per-session data/resize handlers for multiplexed local WS.
    private var sessionDataHandlers: [String: (Data) -> Void] = [:]
    private var sessionResizeHandlers: [String: (Int, Int) -> Void] = [:]

    /// Per-session data/resize handlers for multiplexed WebRTC DataChannel.
    private var webrtcSessionDataHandlers: [String: (Data) -> Void] = [:]
    private var webrtcSessionResizeHandlers: [String: (Int, Int) -> Void] = [:]

    // MARK: - Transports

    /// Local Bonjour + WebSocket (control-only, no sessionId)
    private var browser: NWBrowser?
    private var localWS: URLSessionWebSocketTask?
    private let urlSession = URLSession(configuration: .default)
    private var resolvedHost: String?
    private var resolvedPort: UInt16?
    private var localConnected = false

    /// Detect WiFi ↔ cellular transitions to immediately update local transport state.
    private var networkMonitor = NWPathMonitor()
    private var networkMonitorStarted = false
    private var isOnWiFi = false

    /// Device-level relay WebSocket
    private var deviceWS: URLSessionWebSocketTask?
    private var deviceWSConnected = false
    private var deviceWSGeneration: UInt64 = 0
    private var deviceWSReconnect = ReconnectionManager()
    private var deviceWSReconnectTask: Task<Void, Never>?

    /// Keepalive ping for device WS
    private var deviceWSPingTask: Task<Void, Never>?
    private var deviceWSPongVerifyTask: Task<Void, Never>?
    private var deviceWSAwaitingPong = false

    /// Device-level WebRTC transport — owned, created on first signaling offer.
    private var webrtcTransport: WebRTCTransport?

    // MARK: - Configuration

    private var deviceId: String?
    private var relayBaseURL: String?
    private var authToken: String?
    private var clientId = UUID().uuidString
    private var intentionalClose = false

    // MARK: - Lifecycle

    /// Start local network discovery (Bonjour + WiFi monitoring).
    /// Safe to call early (e.g. when device list appears) — no deviceId needed.
    func startDiscovery() {
        log("startDiscovery()")
        intentionalClose = false
        startNetworkMonitor()
        startBonjourDiscovery()
    }

    /// Start the full transport manager for a specific desktop device.
    /// Calls startDiscovery() if not already running, then connects the relay WS.
    /// Safe to call multiple times — won't tear down an existing connection.
    func start(deviceId: String, relayBaseURL: String, token: String) {
        let deviceChanged = self.deviceId != deviceId
        self.deviceId = deviceId
        self.relayBaseURL = relayBaseURL
        self.authToken = token
        intentionalClose = false

        startDiscovery()

        // Only (re)connect device WS if not already connected for this device
        if deviceChanged || (!deviceWSConnected && deviceWS == nil) {
            connectDeviceWS()
        }
    }

    func stop() {
        intentionalClose = true

        networkMonitor.cancel()
        networkMonitor = NWPathMonitor()
        networkMonitorStarted = false

        browser?.cancel()
        browser = nil

        localWS?.cancel(with: .goingAway, reason: nil)
        localWS = nil
        localConnected = false

        deviceWS?.cancel(with: .goingAway, reason: nil)
        deviceWS = nil
        deviceWSConnected = false
        deviceWSReconnectTask?.cancel()
        deviceWSReconnectTask = nil
        stopDeviceWSPingLoop()

        webrtcTransport?.disconnect()
        webrtcTransport = nil

        isConnected = false
        isConnecting = false
        webrtcMode = nil
        sessions = []
        sessionDataHandlers.removeAll()
        sessionResizeHandlers.removeAll()
        webrtcSessionDataHandlers.removeAll()
        webrtcSessionResizeHandlers.removeAll()
        updateActiveTransport()
    }

    /// Update the auth token (e.g. after refresh).
    func updateToken(_ token: String) {
        authToken = token
    }

    // MARK: - WebRTC

    /// Whether WebRTC transport is connected.
    var isWebRTCConnected: Bool { webrtcTransport?.isConnected ?? false }

    /// Cached ICE server configs from relay (includes TURN credentials).
    private var cachedIceServerConfigs: [[String: Any]]?
    private var fetchingIceServers = false

    /// Create the device-level WebRTC transport on demand (e.g. when first offer arrives).
    private func ensureWebRTCTransport() -> WebRTCTransport {
        if let existing = webrtcTransport { return existing }

        log("Creating WebRTCTransport for clientId=\(clientId)")
        let transport = WebRTCTransport(clientId: clientId)
        transport.iceServerConfigs = cachedIceServerConfigs
        transport.debugLog = { [weak self] msg in self?.log("WebRTC: \(msg)") }

        transport.sendSignaling = { [weak self] msg in
            let type = msg["type"] as? String ?? "?"
            self?.log("WebRTC sendSignaling: \(type)")
            self?.sendSignaling(msg)
        }

        transport.onConnected = { [weak self] in
            self?.log("WebRTC CONNECTED")
            self?.updateActiveTransport()
        }

        transport.onDisconnected = { [weak self] in
            self?.log("WebRTC DISCONNECTED")
            self?.updateActiveTransport()
        }

        transport.onConnectionMode = { [weak self] mode in
            self?.log("WebRTC mode: \(mode.rawValue)")
            self?.webrtcMode = mode
        }

        transport.onTerminalData = { _ in
            // Legacy non-multiplexed data (channel 0x00) — ignored for device-level WebRTC.
            // All session data should use multiplexed frames (0x10/0x11).
        }

        transport.onResize = { _, _ in
            // Legacy non-multiplexed resize (channel 0x01) — ignored for device-level WebRTC.
        }

        transport.onMuxData = { [weak self] data in
            self?.handleWebRTCMuxData(data)
        }

        transport.onControlMessage = { [weak self] json in
            self?.log("WebRTC control: \(json["type"] as? String ?? "?")")
            self?.handleWebRTCControlMessage(json)
        }

        webrtcTransport = transport
        return transport
    }

    /// Fetch TURN credentials and call completion when done (or immediately on failure).
    private func fetchTurnCredentialsSync(completion: @escaping () -> Void) {
        guard cachedIceServerConfigs == nil,
              let relayBase = relayBaseURL, let token = authToken
        else {
            completion()
            return
        }

        let httpBase = relayBase
            .replacingOccurrences(of: "wss://", with: "https://")
            .replacingOccurrences(of: "ws://", with: "http://")

        guard let url = URL(string: "\(httpBase)/turn-credentials") else {
            completion()
            return
        }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            Task { @MainActor in
                if let self, let data,
                   let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200,
                   let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let iceServersArray = json["iceServers"] as? [[String: Any]] {
                    self.log("TURN credentials (sync): got \(iceServersArray.count) ICE servers")
                    self.cachedIceServerConfigs = iceServersArray
                    self.webrtcTransport?.iceServerConfigs = iceServersArray
                }
                completion()
            }
        }.resume()
    }

    /// Fetch TURN credentials from the relay and cache them.
    private func fetchTurnCredentials() {
        guard !fetchingIceServers, cachedIceServerConfigs == nil,
              let relayBase = relayBaseURL, let token = authToken
        else { return }

        fetchingIceServers = true
        let httpBase = relayBase
            .replacingOccurrences(of: "wss://", with: "https://")
            .replacingOccurrences(of: "ws://", with: "http://")

        guard let url = URL(string: "\(httpBase)/turn-credentials") else {
            fetchingIceServers = false
            return
        }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            Task { @MainActor in
                defer { self?.fetchingIceServers = false }
                guard let self else { return }
                let statusCode = (response as? HTTPURLResponse)?.statusCode ?? 0

                guard let data, statusCode == 200 else {
                    let body = data.flatMap { String(data: $0, encoding: .utf8) } ?? "nil"
                    self.log("TURN credentials failed: HTTP \(statusCode) \(error?.localizedDescription ?? body)")
                    return
                }

                guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let iceServersArray = json["iceServers"] as? [[String: Any]]
                else {
                    self.log("TURN credentials: bad response format")
                    return
                }

                self.log("TURN credentials: got \(iceServersArray.count) ICE servers")
                self.cachedIceServerConfigs = iceServersArray
                self.webrtcTransport?.iceServerConfigs = iceServersArray
            }
        }.resume()
    }

    // MARK: - Control API

    func addSessionCreatedHandler(id: String, handler: @escaping (_ requestId: String, _ sessionId: String, _ name: String, _ cwd: String, _ ptyCols: Int, _ ptyRows: Int) -> Void) {
        sessionCreatedHandlers[id] = handler
    }

    func removeSessionCreatedHandler(id: String) {
        sessionCreatedHandlers.removeValue(forKey: id)
    }

    func addSessionsListHandler(id: String, handler: @escaping ([DeviceSessionInfo]) -> Void) {
        sessionsListHandlers[id] = handler
    }

    func removeSessionsListHandler(id: String) {
        sessionsListHandlers.removeValue(forKey: id)
    }

    /// Request the current session list from the best available transport.
    func sendListSessions() {
        let msg: [String: Any] = ["type": "list_sessions"]

        if localConnected {
            sendLocalControl(msg)
        } else if let webrtc = webrtcTransport, webrtc.isConnected {
            webrtc.sendControlMessage(msg)
        } else if deviceWSConnected {
            sendDeviceWSControl(msg)
        }
    }

    /// Request creation of a new session on the desktop.
    func sendCreateSessionRequest(requestId: String) {
        let msg: [String: Any] = [
            "type": "create_session_request",
            "requestId": requestId,
        ]

        if localConnected {
            sendLocalControl(msg)
        } else if let webrtc = webrtcTransport, webrtc.isConnected {
            webrtc.sendControlMessage(msg)
        } else if deviceWSConnected {
            sendDeviceWSControl(msg)
        }
    }

    /// Delete a session on the desktop.
    func sendDeleteSession(sessionId: String) {
        let msg: [String: Any] = [
            "type": "delete_session",
            "sessionId": sessionId,
        ]

        if localConnected {
            sendLocalControl(msg)
        } else if let webrtc = webrtcTransport, webrtc.isConnected {
            webrtc.sendControlMessage(msg)
        } else if deviceWSConnected {
            sendDeviceWSControl(msg)
        }
    }

    /// Send terminal input through the device-level WebRTC data channel.
    func sendWebRTCInput(_ data: Data) {
        webrtcTransport?.sendInput(data)
    }

    /// Send resize through the device-level WebRTC data channel.
    func sendWebRTCResize(cols: Int, rows: Int) {
        webrtcTransport?.sendResize(cols: cols, rows: rows)
    }

    /// Whether any P2P transport (local or WebRTC) is available.
    var hasP2PTransport: Bool {
        localConnected || (webrtcTransport?.isConnected ?? false)
    }

    /// Whether the local WS transport is connected.
    var isLocalConnected: Bool { localConnected }

    /// Expose device-level WebRTC transport for control messages (JSON).
    /// Terminal data goes through multiplexed channels (0x10/0x11) via
    /// sendWebRTCSessionInput/sendWebRTCSessionResize instead.
    var webrtcTransportForControl: WebRTCTransport? { webrtcTransport }

    // MARK: - Session Multiplexing (Local WS)

    /// Subscribe to session data over the multiplexed local WS connection.
    func subscribeSession(sessionId: String, onData: @escaping (Data) -> Void, onResize: @escaping (Int, Int) -> Void) {
        sessionDataHandlers[sessionId] = onData
        sessionResizeHandlers[sessionId] = onResize

        guard localConnected else { return }
        sendLocalControl(["type": "subscribe_session", "sessionId": sessionId])
    }

    /// Unsubscribe from session data.
    func unsubscribeSession(sessionId: String) {
        sessionDataHandlers.removeValue(forKey: sessionId)
        sessionResizeHandlers.removeValue(forKey: sessionId)

        guard localConnected else { return }
        sendLocalControl(["type": "unsubscribe_session", "sessionId": sessionId])
    }

    /// Send terminal input for a specific session over multiplexed local WS.
    func sendSessionInput(sessionId: String, data: Data) {
        guard let ws = localWS else { return }

        let sidBytes = Array(sessionId.utf8)
        var frame = Data(capacity: 2 + sidBytes.count + data.count)
        frame.append(0x00)
        frame.append(UInt8(sidBytes.count))
        frame.append(contentsOf: sidBytes)
        frame.append(data)

        ws.send(.data(frame)) { _ in }
    }

    /// Send resize for a specific session over multiplexed local WS.
    func sendSessionResize(sessionId: String, cols: Int, rows: Int) {
        guard let ws = localWS else { return }

        let sidBytes = Array(sessionId.utf8)
        var frame = Data(capacity: 2 + sidBytes.count + 4)
        frame.append(0x01)
        frame.append(UInt8(sidBytes.count))
        frame.append(contentsOf: sidBytes)
        frame.append(UInt8((cols >> 8) & 0xFF))
        frame.append(UInt8(cols & 0xFF))
        frame.append(UInt8((rows >> 8) & 0xFF))
        frame.append(UInt8(rows & 0xFF))

        ws.send(.data(frame)) { _ in }
    }

    // MARK: - WebRTC Session Multiplexing

    /// Subscribe to session data over the multiplexed WebRTC DataChannel.
    func subscribeWebRTCSession(sessionId: String, onData: @escaping (Data) -> Void, onResize: @escaping (Int, Int) -> Void) {
        webrtcSessionDataHandlers[sessionId] = onData
        webrtcSessionResizeHandlers[sessionId] = onResize
    }

    /// Unsubscribe from WebRTC session data.
    func unsubscribeWebRTCSession(sessionId: String) {
        webrtcSessionDataHandlers.removeValue(forKey: sessionId)
        webrtcSessionResizeHandlers.removeValue(forKey: sessionId)
    }

    /// Send terminal input for a specific session over multiplexed WebRTC: [0x10][sid_len][sid][data]
    func sendWebRTCSessionInput(sessionId: String, data: Data) {
        let sidBytes = Array(sessionId.utf8)
        var frame = Data(capacity: 2 + sidBytes.count + data.count)
        frame.append(0x10)
        frame.append(UInt8(sidBytes.count))
        frame.append(contentsOf: sidBytes)
        frame.append(data)
        webrtcTransport?.sendRawData(frame)
    }

    /// Send resize for a specific session over multiplexed WebRTC: [0x11][sid_len][sid][cols][rows]
    func sendWebRTCSessionResize(sessionId: String, cols: Int, rows: Int) {
        let sidBytes = Array(sessionId.utf8)
        var frame = Data(capacity: 2 + sidBytes.count + 4)
        frame.append(0x11)
        frame.append(UInt8(sidBytes.count))
        frame.append(contentsOf: sidBytes)
        frame.append(UInt8((cols >> 8) & 0xFF))
        frame.append(UInt8(cols & 0xFF))
        frame.append(UInt8((rows >> 8) & 0xFF))
        frame.append(UInt8(rows & 0xFF))
        webrtcTransport?.sendRawData(frame)
    }

    /// Parse multiplexed WebRTC binary frame: [channel][sid_len][sid][payload]
    private func handleWebRTCMuxData(_ data: Data) {
        guard data.count >= 2 else { return }

        let channel = data[0]
        let sidLen = Int(data[1])

        guard sidLen > 0, data.count >= 2 + sidLen else { return }

        let sidData = data[2..<(2 + sidLen)]
        guard let sessionId = String(data: sidData, encoding: .utf8) else { return }

        let payloadStart = 2 + sidLen

        switch channel {
        case 0x10:
            let payload = data[payloadStart...]
            webrtcSessionDataHandlers[sessionId]?(Data(payload))

        case 0x11:
            guard data.count >= payloadStart + 4 else { return }
            let cols = Int(data[payloadStart]) << 8 | Int(data[payloadStart + 1])
            let rows = Int(data[payloadStart + 2]) << 8 | Int(data[payloadStart + 3])
            webrtcSessionResizeHandlers[sessionId]?(cols, rows)

        default:
            break
        }
    }

    // MARK: - Network Monitor

    private func startNetworkMonitor() {
        guard !networkMonitorStarted else { return }
        networkMonitorStarted = true

        networkMonitor.pathUpdateHandler = { [weak self] path in
            let wifi = path.usesInterfaceType(.wifi)

            Task { @MainActor in
                guard let self, !self.intentionalClose else { return }
                let wasOnWiFi = self.isOnWiFi
                self.isOnWiFi = wifi

                if wifi && !wasOnWiFi {
                    self.log("WiFi regained — restarting Bonjour")
                    self.browser?.cancel()
                    self.browser = nil
                    self.startBonjourDiscovery()

                    // Device WS may need to reconnect on the new interface
                    if !self.deviceWSConnected && self.deviceId != nil {
                        self.connectDeviceWS()
                    }
                } else if !wifi && wasOnWiFi {
                    self.log("WiFi lost — tearing down local, reconnecting on cellular")
                    self.browser?.cancel()
                    self.browser = nil
                    self.localWS?.cancel(with: .goingAway, reason: nil)
                    self.localWS = nil
                    self.localConnected = false
                    self.resolvedHost = nil
                    self.resolvedPort = nil
                    self.updateActiveTransport()

                    // Device WS was on WiFi — force reconnect on cellular
                    if self.deviceWSConnected || self.deviceWS != nil {
                        self.forceReconnectDeviceWS()
                    }

                    // Notify session relays to reconnect on new interface
                    NotificationCenter.default.post(name: .networkInterfaceChanged, object: nil)
                }
            }
        }

        networkMonitor.start(queue: .main)
    }

    // MARK: - Bonjour Discovery + Local WebSocket

    private func startBonjourDiscovery() {
        guard browser == nil else { return }

        let params = NWParameters()
        params.includePeerToPeer = true

        browser = NWBrowser(for: .bonjour(type: "_termpod._tcp", domain: "local."), using: params)

        browser?.browseResultsChangedHandler = { [weak self] results, _ in
            Task { @MainActor in
                self?.handleBrowseResults(results)
            }
        }

        browser?.stateUpdateHandler = { _ in }
        browser?.start(queue: .main)
    }

    private func handleBrowseResults(_ results: Set<NWBrowser.Result>) {
        if results.isEmpty {
            localConnected = false
            localWS?.cancel(with: .goingAway, reason: nil)
            localWS = nil
            updateActiveTransport()
            return
        }

        guard localWS == nil else { return }

        for result in results {
            if case .service(_, _, _, _) = result.endpoint {
                resolveEndpoint(result: result)
                return
            }
        }
    }

    private func resolveEndpoint(result: NWBrowser.Result) {
        let connection = NWConnection(to: result.endpoint, using: .tcp)

        connection.stateUpdateHandler = { [weak self] state in
            guard let self else { return }

            if case .ready = state {
                if let path = connection.currentPath,
                   let endpoint = path.remoteEndpoint,
                   case .hostPort(let host, let port) = endpoint {
                    let hostStr: String

                    switch host {
                    case .ipv4(let addr):
                        let raw = "\(addr)"
                        hostStr = raw.components(separatedBy: "%").first ?? raw
                    case .ipv6(let addr):
                        let raw = "\(addr)"
                        let clean = raw.components(separatedBy: "%").first ?? raw
                        hostStr = "[\(clean)]"
                    case .name(let name, _):
                        hostStr = name
                    @unknown default:
                        hostStr = "unknown"
                    }

                    Task { @MainActor in
                        self.resolvedHost = hostStr
                        self.resolvedPort = port.rawValue
                        self.connectLocalWS()
                    }
                }

                connection.cancel()
            }
        }

        connection.start(queue: .main)
    }

    private func connectLocalWS() {
        guard let host = resolvedHost, let port = resolvedPort,
              let url = URL(string: "ws://\(host):\(port)")
        else { return }

        localWS?.cancel(with: .goingAway, reason: nil)

        let ws = urlSession.webSocketTask(with: url)
        localWS = ws
        ws.resume()

        // Send hello (no sessionId — control-only connection)
        let hello: [String: Any] = [
            "type": "hello",
            "version": 1,
            "role": "viewer",
            "device": UIDevice.current.userInterfaceIdiom == .pad ? "ipad" : "iphone",
            "clientId": "device-\(clientId)",
        ]

        sendJSON(ws: ws, msg: hello)
        startLocalReceiving()
    }

    private func startLocalReceiving() {
        localWS?.receive { [weak self] result in
            guard let self else { return }

            switch result {
            case .success(let message):
                Task { @MainActor in
                    self.handleLocalMessage(message)
                    self.startLocalReceiving()
                }
            case .failure:
                Task { @MainActor in
                    self.handleLocalDisconnect()
                }
            }
        }
    }

    private func handleLocalMessage(_ message: URLSessionWebSocketTask.Message) {
        switch message {
        case .data(let rawData):
            handleLocalBinaryMessage(rawData)

        case .string(let text):
            guard let data = text.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let type = json["type"] as? String
            else { return }

            switch type {
            case "ready":
                localConnected = true
                updateActiveTransport()
                // Re-subscribe all active sessions
                for sessionId in sessionDataHandlers.keys {
                    sendLocalControl(["type": "subscribe_session", "sessionId": sessionId])
                }
                // Request session list on connect
                sendLocalControl(["type": "list_sessions"])

            case "sessions_list", "sessions_updated":
                if let sessionsArray = json["sessions"] as? [[String: Any]] {
                    let parsed = parseSessionsList(sessionsArray)
                    sessions = parsed
                    dispatchSessionsList(parsed)
                }

            case "session_created":
                handleSessionCreatedMessage(json)

            case "session_closed", "session_ended":
                if let sessionId = json["sessionId"] as? String {
                    sessions.removeAll { $0.id == sessionId }
                }

            default:
                break
            }

        @unknown default:
            break
        }
    }

    /// Parse multiplexed binary frame: [channel][sid_len][sid][payload]
    private func handleLocalBinaryMessage(_ data: Data) {
        guard data.count >= 2 else { return }

        let channel = data[0]
        let sidLen = Int(data[1])

        guard sidLen > 0, data.count >= 2 + sidLen else { return }

        let sidData = data[2..<(2 + sidLen)]
        guard let sessionId = String(data: sidData, encoding: .utf8) else { return }

        let payloadStart = 2 + sidLen

        switch channel {
        case 0x00:
            let payload = data[payloadStart...]
            sessionDataHandlers[sessionId]?(Data(payload))

        case 0x01:
            guard data.count >= payloadStart + 4 else { return }
            let cols = Int(data[payloadStart]) << 8 | Int(data[payloadStart + 1])
            let rows = Int(data[payloadStart + 2]) << 8 | Int(data[payloadStart + 3])
            sessionResizeHandlers[sessionId]?(cols, rows)

        case 0x02:
            // Scrollback — deliver as terminal data
            let payload = data[payloadStart...]
            sessionDataHandlers[sessionId]?(Data(payload))

        default:
            break
        }
    }

    private func handleLocalDisconnect() {
        localWS = nil
        localConnected = false
        // Keep session handlers intact — on reconnect, the `ready` handler
        // re-subscribes all sessions. Sessions fall back to relay in the meantime.
        updateActiveTransport()

        guard !intentionalClose else { return }

        // Restart Bonjour discovery after a delay
        browser?.cancel()
        browser = nil

        Task {
            try? await Task.sleep(for: .seconds(2))
            guard !intentionalClose else { return }
            startBonjourDiscovery()
        }
    }

    func sendLocalControl(_ msg: [String: Any]) {
        guard let ws = localWS else { return }
        sendJSON(ws: ws, msg: msg)
    }

    // MARK: - Device WebSocket (Relay)

    private func connectDeviceWS() {
        // Don't tear down an active or in-flight connection
        if deviceWSConnected || deviceWS != nil {
            log("connectDeviceWS: skipped (connected=\(deviceWSConnected) ws=\(deviceWS != nil))")
            return
        }

        guard let deviceId, let relayBase = relayBaseURL, let token = authToken else {
            log("connectDeviceWS: missing config (deviceId=\(deviceId != nil) relay=\(relayBaseURL != nil) token=\(authToken != nil))")
            return
        }

        let wsBase = relayBase
            .replacingOccurrences(of: "https://", with: "wss://")
            .replacingOccurrences(of: "http://", with: "ws://")

        guard var components = URLComponents(string: "\(wsBase)/devices/\(deviceId)/ws") else {
            log("connectDeviceWS: bad URL")
            return
        }
        components.queryItems = [URLQueryItem(name: "token", value: token)]

        guard let url = components.url else {
            log("connectDeviceWS: bad URL after adding token")
            return
        }

        log("connectDeviceWS: \(url.host ?? "?")/devices/\(deviceId)/ws")
        isConnecting = true

        deviceWSGeneration &+= 1
        let generation = deviceWSGeneration

        let ws = urlSession.webSocketTask(with: url)
        deviceWS = ws
        ws.resume()

        // Auth is via URL token — send hello immediately
        let hello: [String: Any] = [
            "type": "hello",
            "role": "viewer",
            "device": UIDevice.current.userInterfaceIdiom == .pad ? "ipad" : "iphone",
            "clientId": clientId,
            "version": 1,
        ]
        sendJSON(ws: ws, msg: hello)
        startDeviceWSReceiving(generation: generation)
    }

    private func startDeviceWSReceiving(generation: UInt64) {
        deviceWS?.receive { [weak self] result in
            guard let self else { return }

            Task { @MainActor in
                // Ignore callbacks from stale WS connections
                guard self.deviceWSGeneration == generation else { return }

                switch result {
                case .success(let message):
                    self.handleDeviceWSMessage(message)
                    self.startDeviceWSReceiving(generation: generation)
                case .failure(let error):
                    self.log("Device WS receive error: \(error.localizedDescription)")
                    self.handleDeviceWSDisconnect()
                }
            }
        }
    }

    private func handleDeviceWSMessage(_ message: URLSessionWebSocketTask.Message) {
        guard case .string(let text) = message,
              let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String
        else { return }

        log("WS msg: \(type)")

        switch type {
        case "auth_ok":
            // No-op: auth is now via URL token, hello sent on connect
            break

        case "hello_ok":
            deviceWSConnected = true
            deviceWSReconnect.reset()
            startDeviceWSPingLoop()
            updateActiveTransport()
            fetchTurnCredentials()
            // Request session list if we don't have local
            if !localConnected {
                sendDeviceWSControl(["type": "list_sessions"])
            }

        case "sessions_list":
            if let sessionsArray = json["sessions"] as? [[String: Any]] {
                let parsed = parseSessionsList(sessionsArray)
                // Only update from device WS if local isn't providing data
                if !localConnected {
                    sessions = parsed
                }
                dispatchSessionsList(parsed)
            }

        case "sessions_updated":
            if let sessionsArray = json["sessions"] as? [[String: Any]] {
                let parsed = parseSessionsList(sessionsArray)
                sessions = parsed
                dispatchSessionsList(parsed)
            }

        case "session_created":
            handleSessionCreatedMessage(json)

        case "session_closed":
            if let sessionId = json["sessionId"] as? String {
                sessions.removeAll { $0.id == sessionId }
            }

        case "client_joined":
            // Desktop or another viewer joined — could trigger WebRTC signaling
            break

        case "client_left":
            break

        case "webrtc_offer":
            log("Signaling: \(type) keys=\(json.keys.sorted())")
            // Fetch TURN credentials synchronously if not yet cached
            if cachedIceServerConfigs == nil {
                log("Deferring webrtc_offer until TURN credentials fetched")
                let deferredJson = json
                fetchTurnCredentialsSync { [weak self] in
                    self?.ensureWebRTCTransport().handleSignaling(deferredJson)
                }
            } else {
                ensureWebRTCTransport().handleSignaling(json)
            }

        case "webrtc_answer", "webrtc_ice":
            log("Signaling: \(type) keys=\(json.keys.sorted())")
            ensureWebRTCTransport().handleSignaling(json)

        case "pong":
            deviceWSAwaitingPong = false

        default:
            break
        }
    }

    private func handleDeviceWSDisconnect() {
        stopDeviceWSPingLoop()
        deviceWS = nil
        deviceWSConnected = false
        updateActiveTransport()

        guard !intentionalClose else { return }

        let attempt = deviceWSReconnect.nextAttempt()

        deviceWSReconnectTask = Task {
            try? await Task.sleep(for: .seconds(attempt.delay))
            guard !Task.isCancelled, !intentionalClose else { return }
            connectDeviceWS()
        }
    }

    private func sendDeviceWSControl(_ msg: [String: Any]) {
        guard let ws = deviceWS else { return }
        sendJSON(ws: ws, msg: msg)
    }

    /// Send WebRTC signaling through device WS.
    func sendSignaling(_ msg: [String: Any]) {
        sendDeviceWSControl(msg)
    }

    // MARK: - Device WS Keepalive

    /// Periodic ping every 25s to prevent carrier NAT from killing idle connections.
    private func startDeviceWSPingLoop() {
        stopDeviceWSPingLoop()

        deviceWSPingTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(25))
                guard !Task.isCancelled, let self, self.deviceWSConnected else { return }

                if self.deviceWSAwaitingPong {
                    self.log("Device WS ping timeout — forcing reconnect")
                    self.deviceWSAwaitingPong = false
                    self.forceReconnectDeviceWS()
                    return
                }

                self.deviceWSAwaitingPong = true
                self.sendDeviceWSControl(["type": "ping", "timestamp": Int(Date().timeIntervalSince1970 * 1000)])
            }
        }
    }

    private func stopDeviceWSPingLoop() {
        deviceWSPingTask?.cancel()
        deviceWSPingTask = nil
        deviceWSPongVerifyTask?.cancel()
        deviceWSPongVerifyTask = nil
        deviceWSAwaitingPong = false
    }

    /// Tear down device WS and reconnect immediately (no backoff).
    private func forceReconnectDeviceWS() {
        stopDeviceWSPingLoop()
        deviceWSReconnectTask?.cancel()
        deviceWS?.cancel(with: .goingAway, reason: nil)
        deviceWS = nil
        deviceWSConnected = false
        deviceWSReconnect.reset()
        updateActiveTransport()
        connectDeviceWS()
    }

    // MARK: - Foreground Recovery

    /// Verify all transports are alive after returning from background.
    func reconnectIfNeeded() {
        guard !intentionalClose else { return }

        // Verify device WS
        if deviceWSConnected {
            // Send ping with short timeout to verify
            deviceWSPongVerifyTask?.cancel()
            deviceWSAwaitingPong = true
            sendDeviceWSControl(["type": "ping", "timestamp": Int(Date().timeIntervalSince1970 * 1000)])

            deviceWSPongVerifyTask = Task {
                try? await Task.sleep(for: .seconds(5))
                guard !Task.isCancelled, self.deviceWSAwaitingPong else { return }
                self.log("Device WS verification ping timeout — forcing reconnect")
                self.forceReconnectDeviceWS()
            }
        } else if deviceId != nil && deviceWS == nil {
            log("Device WS not connected — reconnecting")
            deviceWSReconnect.reset()
            connectDeviceWS()
        }

        // Restart Bonjour if on WiFi but not locally connected
        if isOnWiFi && !localConnected && browser == nil {
            log("Restarting Bonjour discovery after foreground")
            startBonjourDiscovery()
        }
    }

    // MARK: - WebRTC Control Message Handling

    /// Called by ConnectionManager when WebRTC receives a control message.
    func handleWebRTCControlMessage(_ json: [String: Any]) {
        guard let type = json["type"] as? String else { return }

        switch type {
        case "sessions_list":
            if let sessionsArray = json["sessions"] as? [[String: Any]] {
                let parsed = parseSessionsList(sessionsArray)
                sessions = parsed
                dispatchSessionsList(parsed)
            }

        case "session_created":
            handleSessionCreatedMessage(json)

        case "session_closed", "session_ended":
            if let sessionId = json["sessionId"] as? String {
                sessions.removeAll { $0.id == sessionId }
            }

        default:
            break
        }
    }

    // MARK: - Helpers

    private func updateActiveTransport() {
        let previous = activeTransport

        if localConnected {
            activeTransport = .local
        } else if webrtcTransport?.isConnected ?? false {
            activeTransport = .webrtc
        } else {
            activeTransport = .relay
        }

        isConnected = localConnected || (webrtcTransport?.isConnected ?? false) || deviceWSConnected
        if isConnected { isConnecting = false }

        if activeTransport != previous {
            log("Transport: \(previous) → \(activeTransport) (local=\(localConnected) webrtc=\(webrtcTransport?.isConnected ?? false) relay=\(deviceWSConnected))")
            objectWillChange.send()
        }
    }

    private func parseSessionsList(_ sessionsArray: [[String: Any]]) -> [DeviceSessionInfo] {
        sessionsArray.compactMap { json in
            guard let id = json["id"] as? String,
                  let name = json["name"] as? String
            else { return nil }

            return DeviceSessionInfo(
                id: id,
                name: name,
                cwd: json["cwd"] as? String ?? "~",
                processName: json["processName"] as? String ?? json["process_name"] as? String,
                ptyCols: json["ptyCols"] as? Int ?? json["pty_cols"] as? Int ?? 80,
                ptyRows: json["ptyRows"] as? Int ?? json["pty_rows"] as? Int ?? 24
            )
        }
    }

    private func handleSessionCreatedMessage(_ json: [String: Any]) {
        guard let requestId = json["requestId"] as? String,
              let sessionId = json["sessionId"] as? String,
              let name = json["name"] as? String,
              let cwd = json["cwd"] as? String,
              let ptyCols = json["ptyCols"] as? Int,
              let ptyRows = json["ptyRows"] as? Int
        else { return }

        if let handler = sessionCreatedHandlers.removeValue(forKey: requestId) {
            handler(requestId, sessionId, name, cwd, ptyCols, ptyRows)
        }
    }

    private func dispatchSessionsList(_ parsed: [DeviceSessionInfo]) {
        let handlers = sessionsListHandlers
        sessionsListHandlers.removeAll()

        for (_, handler) in handlers {
            handler(parsed)
        }
    }

    private func sendJSON(ws: URLSessionWebSocketTask, msg: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: msg),
              let str = String(data: data, encoding: .utf8)
        else { return }

        ws.send(.string(str)) { _ in }
    }
}
