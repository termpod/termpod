import Foundation
import UIKit

/// Manages the WebSocket connection to the Termpod relay server.
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
        storedURL = nil
        reconnectionManager.reset()
        webSocket?.cancel(with: .goingAway, reason: nil)
        webSocket = nil
        state = .disconnected
    }

    // MARK: - Sending

    func sendInput(_ data: Data) {
        // Channel 0x00 = terminal data
        var frame = Data([0x00])
        frame.append(data)
        webSocket?.send(.data(frame)) { error in
            if let error { print("[Relay] Send error: \(error)") }
        }
    }

    func sendResize(cols: Int, rows: Int) {
        // Channel 0x01 = terminal resize: [0x01][cols:u16be][rows:u16be]
        var frame = Data(count: 5)
        frame[0] = 0x01
        frame[1] = UInt8((cols >> 8) & 0xFF)
        frame[2] = UInt8(cols & 0xFF)
        frame[3] = UInt8((rows >> 8) & 0xFF)
        frame[4] = UInt8(rows & 0xFF)
        webSocket?.send(.data(frame)) { error in
            if let error { print("[Relay] Resize send error: \(error)") }
        }
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

        case "session_ended":
            state = .disconnected

        case "error":
            let code = json["code"] as? String ?? "UNKNOWN"
            let message = json["message"] as? String ?? "Unknown error"
            print("[Relay] Error: \(code) — \(message)")

        case "webrtc_offer", "webrtc_answer", "webrtc_ice":
            onSignaling?(json)

        default:
            break
        }
    }

    // MARK: - Reconnection

    private func handleDisconnect(error: Error) {
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
