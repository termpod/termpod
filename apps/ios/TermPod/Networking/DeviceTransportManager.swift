import Combine
import Foundation
import Network
import UIKit

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

    /// Keyed completion handlers for request/response patterns.
    private var sessionCreatedHandlers: [String: (_ requestId: String, _ sessionId: String, _ name: String, _ cwd: String, _ ptyCols: Int, _ ptyRows: Int) -> Void] = [:]
    private var sessionsListHandlers: [String: ([DeviceSessionInfo]) -> Void] = [:]

    /// Per-session data/resize handlers for multiplexed local WS.
    private var sessionDataHandlers: [String: (Data) -> Void] = [:]
    private var sessionResizeHandlers: [String: (Int, Int) -> Void] = [:]

    // MARK: - Transports

    /// Local Bonjour + WebSocket (control-only, no sessionId)
    private var browser: NWBrowser?
    private var localWS: URLSessionWebSocketTask?
    private let urlSession = URLSession(configuration: .default)
    private var resolvedHost: String?
    private var resolvedPort: UInt16?
    private var localConnected = false

    /// Device-level relay WebSocket
    private var deviceWS: URLSessionWebSocketTask?
    private var deviceWSConnected = false
    private var deviceWSReconnect = ReconnectionManager()
    private var deviceWSReconnectTask: Task<Void, Never>?

    /// WebRTC transport borrowed from an active session's ConnectionManager
    private weak var registeredWebRTC: WebRTCTransport?

    // MARK: - Configuration

    private var deviceId: String?
    private var relayBaseURL: String?
    private var authToken: String?
    private var clientId = UUID().uuidString
    private var intentionalClose = false

    // MARK: - Lifecycle

    /// Start the transport manager for a specific desktop device.
    func start(deviceId: String, relayBaseURL: String, token: String) {
        self.deviceId = deviceId
        self.relayBaseURL = relayBaseURL
        self.authToken = token
        intentionalClose = false

        startBonjourDiscovery()
        connectDeviceWS()
    }

    func stop() {
        intentionalClose = true

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

        registeredWebRTC = nil

        isConnected = false
        sessions = []
        updateActiveTransport()
    }

    /// Update the auth token (e.g. after refresh).
    func updateToken(_ token: String) {
        authToken = token
    }

    // MARK: - WebRTC Registration

    /// Register a WebRTC transport from an active session for control message fallback.
    func registerWebRTC(_ transport: WebRTCTransport) {
        registeredWebRTC = transport
        updateActiveTransport()
    }

    /// Unregister the WebRTC transport (e.g. when session disconnects).
    func unregisterWebRTC(_ transport: WebRTCTransport) {
        if registeredWebRTC === transport {
            registeredWebRTC = nil
            updateActiveTransport()
        }
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
        } else if let webrtc = registeredWebRTC, webrtc.isConnected {
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
        } else if let webrtc = registeredWebRTC, webrtc.isConnected {
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
        } else if let webrtc = registeredWebRTC, webrtc.isConnected {
            webrtc.sendControlMessage(msg)
        } else if deviceWSConnected {
            sendDeviceWSControl(msg)
        }
    }

    /// Whether any P2P transport (local or WebRTC) is available.
    var hasP2PTransport: Bool {
        localConnected || (registeredWebRTC?.isConnected ?? false)
    }

    /// Whether the local WS transport is connected.
    var isLocalConnected: Bool { localConnected }

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
        // Clear session handlers — sessions will fall back to other transports
        sessionDataHandlers.removeAll()
        sessionResizeHandlers.removeAll()
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
        guard let deviceId, let relayBase = relayBaseURL, let token = authToken else { return }

        let wsBase = relayBase
            .replacingOccurrences(of: "https://", with: "wss://")
            .replacingOccurrences(of: "http://", with: "ws://")

        guard let url = URL(string: "\(wsBase)/devices/\(deviceId)/ws") else { return }

        deviceWS?.cancel(with: .goingAway, reason: nil)

        let ws = urlSession.webSocketTask(with: url)
        deviceWS = ws
        ws.resume()

        // Send auth as first message
        sendJSON(ws: ws, msg: ["type": "auth", "token": token])
        startDeviceWSReceiving()
    }

    private func startDeviceWSReceiving() {
        deviceWS?.receive { [weak self] result in
            guard let self else { return }

            switch result {
            case .success(let message):
                Task { @MainActor in
                    self.handleDeviceWSMessage(message)
                    self.startDeviceWSReceiving()
                }
            case .failure:
                Task { @MainActor in
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

        switch type {
        case "auth_ok":
            // Send hello
            let hello: [String: Any] = [
                "type": "hello",
                "role": "viewer",
                "device": UIDevice.current.userInterfaceIdiom == .pad ? "ipad" : "iphone",
                "clientId": clientId,
            ]
            guard let ws = deviceWS else { return }
            sendJSON(ws: ws, msg: hello)

        case "hello_ok":
            deviceWSConnected = true
            deviceWSReconnect.reset()
            updateActiveTransport()
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

        case "webrtc_offer", "webrtc_answer", "webrtc_ice":
            // Forward signaling to registered WebRTC transport
            registeredWebRTC?.handleSignaling(json)

        case "pong":
            break

        default:
            break
        }
    }

    private func handleDeviceWSDisconnect() {
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
        } else if registeredWebRTC?.isConnected ?? false {
            activeTransport = .webrtc
        } else {
            activeTransport = .relay
        }

        isConnected = localConnected || (registeredWebRTC?.isConnected ?? false) || deviceWSConnected

        if activeTransport != previous {
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
