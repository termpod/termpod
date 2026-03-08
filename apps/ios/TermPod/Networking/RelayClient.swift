import Foundation
import UIKit

/// Manages the WebSocket connection to the TermPod relay server.
@MainActor
final class RelayClient: ObservableObject, Transport {

    let transportType: TransportType = .relay

    var isConnected: Bool { state == .live }

    var onConnected: (() -> Void)?
    var onDisconnected: (() -> Void)?

    @Published var state: ConnectionState = .disconnected
    @Published var connectedViewers: Int = 0
    @Published var ptySize: (cols: Int, rows: Int) = (80, 24)

    var onTerminalData: ((Data) -> Void)?
    var onResize: ((Int, Int) -> Void)?
    var onSignaling: (([String: Any]) -> Void)?
    var onSessionCreated: ((_ requestId: String, _ sessionId: String, _ name: String, _ cwd: String, _ ptyCols: Int, _ ptyRows: Int) -> Void)?
    var onSessionClosed: (() -> Void)?

    private var webSocket: URLSessionWebSocketTask?
    private let session = URLSession(configuration: .default)
    private var reconnectionManager = ReconnectionManager()
    private let clientId = UUID().uuidString

    // Stored for reconnection
    private var storedURL: URL?
    private var storedToken: String?

    // Generation counter to ignore stale receive callbacks after reconnect
    private var wsGeneration: UInt64 = 0

    // Keepalive ping
    private var pingTask: Task<Void, Never>?
    private var pongVerifyTask: Task<Void, Never>?
    private var awaitingPong = false

    enum ConnectionState: Equatable {
        case disconnected
        case connecting
        case connected
        case loadingScrollback
        case live
        case reconnecting(attempt: Int)

        var isTransient: Bool {
            switch self {
            case .connecting, .loadingScrollback, .reconnecting:
                return true
            default:
                return false
            }
        }
    }

    // MARK: - Connection

    func connect(wsURL: URL, token: String? = nil) {
        storedURL = wsURL
        storedToken = token
        state = .connecting

        wsGeneration &+= 1
        let generation = wsGeneration

        webSocket = session.webSocketTask(with: wsURL)
        webSocket?.resume()

        state = .connected

        if let token {
            sendAuth(token: token)
        } else {
            sendHello()
        }

        startReceiving(generation: generation)
    }

    func disconnect() {
        tearDown()
    }

    /// Shared cleanup: stops reconnection, cancels socket, resets state.
    private func tearDown() {
        state = .disconnected
        storedURL = nil
        storedToken = nil
        reconnectionManager.reset()
        stopPingLoop()
        webSocket?.cancel(with: .goingAway, reason: nil)
        webSocket = nil
    }

    // MARK: - Sending

    func sendInput(_ data: Data) {
        // Channel 0x00 = terminal data
        var frame = Data([0x00])
        frame.append(data)
        webSocket?.send(.data(frame)) { _ in }
    }

    func sendResize(cols: Int, rows: Int) {
        // Channel 0x01 = terminal resize: [0x01][cols:u16be][rows:u16be]
        var frame = Data(count: 5)
        frame[0] = 0x01
        frame[1] = UInt8((cols >> 8) & 0xFF)
        frame[2] = UInt8(cols & 0xFF)
        frame[3] = UInt8((rows >> 8) & 0xFF)
        frame[4] = UInt8(rows & 0xFF)
        webSocket?.send(.data(frame)) { _ in }
    }

    private func sendAuth(token: String) {
        let auth: [String: Any] = [
            "type": "auth",
            "token": token,
        ]

        guard let jsonData = try? JSONSerialization.data(withJSONObject: auth),
              let jsonString = String(data: jsonData, encoding: .utf8)
        else { return }

        webSocket?.send(.string(jsonString)) { _ in }
    }

    private func sendHello() {
        let hello: [String: Any] = [
            "type": "hello",
            "version": 1,
            "role": "viewer",
            "device": UIDevice.current.userInterfaceIdiom == .pad ? "ipad" : "iphone",
            "clientId": clientId,
        ]

        guard let jsonData = try? JSONSerialization.data(withJSONObject: hello),
              let jsonString = String(data: jsonData, encoding: .utf8)
        else { return }

        webSocket?.send(.string(jsonString)) { _ in }
    }

    func sendSignaling(_ msg: [String: Any]) {
        guard let jsonData = try? JSONSerialization.data(withJSONObject: msg),
              let jsonString = String(data: jsonData, encoding: .utf8)
        else { return }

        webSocket?.send(.string(jsonString)) { _ in }
    }

    private func sendPing() {
        let ping: [String: Any] = [
            "type": "ping",
            "timestamp": Int(Date().timeIntervalSince1970 * 1000),
        ]

        guard let jsonData = try? JSONSerialization.data(withJSONObject: ping),
              let jsonString = String(data: jsonData, encoding: .utf8)
        else { return }

        webSocket?.send(.string(jsonString)) { _ in }
    }

    // MARK: - Keepalive

    /// Periodic ping every 25s to prevent carrier NAT from killing idle connections.
    /// If the previous ping didn't receive a pong, the connection is considered dead.
    private func startPingLoop() {
        stopPingLoop()

        pingTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(25))
                guard !Task.isCancelled, let self, self.state == .live else { return }

                if self.awaitingPong {
                    self.awaitingPong = false
                    self.forceReconnect()
                    return
                }

                self.awaitingPong = true
                self.sendPing()
            }
        }
    }

    private func stopPingLoop() {
        pingTask?.cancel()
        pingTask = nil
        pongVerifyTask?.cancel()
        pongVerifyTask = nil
        awaitingPong = false
    }

    /// Tear down the current socket and reconnect immediately (no backoff).
    private func forceReconnect() {
        stopPingLoop()
        webSocket?.cancel(with: .goingAway, reason: nil)
        webSocket = nil

        guard let url = storedURL else {
            state = .disconnected
            return
        }

        reconnectionManager.reset()
        connect(wsURL: url, token: storedToken)
    }

    // MARK: - Foreground Recovery

    /// Verify the connection is still alive after returning from background.
    /// Sends a ping with a 5s timeout; reconnects if no pong.
    func reconnectIfNeeded() {
        guard storedURL != nil else { return }
        if case .reconnecting = state { return }
        if state == .connecting { return }

        if webSocket == nil {
            forceReconnect()
            return
        }

        // Verify with short-timeout ping
        pongVerifyTask?.cancel()
        awaitingPong = true
        sendPing()

        pongVerifyTask = Task {
            try? await Task.sleep(for: .seconds(5))
            guard !Task.isCancelled, self.awaitingPong else { return }
            self.forceReconnect()
        }
    }

    /// Called when the network interface changes (WiFi ↔ cellular).
    /// The old TCP connection is dead — reconnect immediately.
    func handleNetworkChange() {
        guard storedURL != nil else { return }
        forceReconnect()
    }

    // MARK: - Receiving

    private func startReceiving(generation: UInt64) {
        webSocket?.receive { [weak self] result in
            guard let self else { return }

            Task { @MainActor in
                guard self.wsGeneration == generation else { return }

                switch result {
                case .success(let message):
                    self.handleMessage(message)
                    self.startReceiving(generation: generation)

                case .failure(let error):
                    self.handleDisconnect(error: error)
                }
            }
        }
    }

    private func handleMessage(_ message: URLSessionWebSocketTask.Message) {
        switch message {

        case .data(let data):
            guard let channel = data.first else { return }

            switch channel {
            case 0x00:
                // Terminal data — strip channel byte
                onTerminalData?(Data(data.dropFirst()))

            case 0x02:
                // Scrollback chunk: [0x02][offset:u32be][data...]
                state = .loadingScrollback
                let payload = data.dropFirst(5) // 1 channel + 4 offset bytes
                onTerminalData?(Data(payload))

            default:
                break
            }

        case .string(let text):
            guard let jsonData = text.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
                  let type = json["type"] as? String
            else { return }

            handleControlMessage(type: type, json: json)

        @unknown default:
            break
        }
    }

    private func handleControlMessage(type: String, json: [String: Any]) {
        switch type {
        case "auth_ok":
            // Auth confirmed — now send hello. Reset backoff since handshake succeeded.
            reconnectionManager.reset()
            sendHello()

        case "session_info":
            if let ptySizeDict = json["ptySize"] as? [String: Int],
               let cols = ptySizeDict["cols"],
               let rows = ptySizeDict["rows"] {
                ptySize = (cols, rows)
                onResize?(cols, rows)
            }

        case "ready":
            state = .live
            reconnectionManager.reset()
            startPingLoop()
            onConnected?()

        case "pty_resize":
            if let cols = json["cols"] as? Int, let rows = json["rows"] as? Int {
                ptySize = (cols, rows)
                onResize?(cols, rows)
            }

        case "client_joined":
            connectedViewers += 1

        case "client_left":
            connectedViewers = max(0, connectedViewers - 1)
            let leftRole = json["role"] as? String ?? "unknown"
            if leftRole == "desktop" {
                tearDown()
                onSessionClosed?()
            }

        case "session_ended", "session_closed":
            tearDown()
            onSessionClosed?()

        case "pong":
            awaitingPong = false

        case "error":
            break

        case "session_created":
            if let requestId = json["requestId"] as? String,
               let sessionId = json["sessionId"] as? String,
               let name = json["name"] as? String,
               let cwd = json["cwd"] as? String,
               let ptyCols = json["ptyCols"] as? Int,
               let ptyRows = json["ptyRows"] as? Int {
                onSessionCreated?(requestId, sessionId, name, cwd, ptyCols, ptyRows)
            }

        case "webrtc_offer", "webrtc_answer", "webrtc_ice":
            onSignaling?(json)

        default:
            break
        }
    }

    // MARK: - Reconnection

    private func handleDisconnect(error: Error) {
        guard state != .disconnected else { return }

        stopPingLoop()
        webSocket?.cancel(with: .goingAway, reason: nil)
        webSocket = nil

        guard let url = storedURL else {
            state = .disconnected
            return
        }

        let attempt = reconnectionManager.nextAttempt()
        state = .reconnecting(attempt: attempt.number)

        Task {
            try? await Task.sleep(for: .seconds(attempt.delay))
            guard state != .disconnected else { return }
            connect(wsURL: url, token: storedToken)
        }
    }
}
