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

    func connect(wsURL: URL) {
        storedURL = wsURL
        state = .connecting

        webSocket = session.webSocketTask(with: wsURL)
        webSocket?.resume()

        state = .connected
        sendHello()
        startReceiving()
    }

    func disconnect() {
        tearDown()
    }

    /// Shared cleanup: stops reconnection, cancels socket, resets state.
    private func tearDown() {
        state = .disconnected
        storedURL = nil
        reconnectionManager.reset()
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

    // MARK: - Receiving

    private func startReceiving() {
        webSocket?.receive { [weak self] result in
            guard let self else { return }

            switch result {
            case .success(let message):
                Task { @MainActor in
                    self.handleMessage(message)
                    self.startReceiving()
                }

            case .failure(let error):
                Task { @MainActor in
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
            let leftReason = json["reason"] as? String ?? "unknown"
            print("[Relay] client_left role=\(leftRole) reason=\(leftReason)")
            if leftRole == "desktop" {
                tearDown()
                onSessionClosed?()
            }

        case "session_ended", "session_closed":
            print("[Relay] \(type) received — tearing down")
            tearDown()
            onSessionClosed?()

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
        print("[Relay] handleDisconnect error=\(error.localizedDescription) state=\(state)")
        guard state != .disconnected else { return }

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
            connect(wsURL: url)
        }
    }
}
