import Foundation
import Network
import UIKit

/// Discovers a Termpod desktop on the local network via Bonjour,
/// then connects directly via WebSocket for lowest-latency communication.
@MainActor
final class LocalTransport: Transport {

    let transportType: TransportType = .local

    var isConnected: Bool { webSocket != nil && connected }

    var onTerminalData: ((Data) -> Void)?
    var onResize: ((Int, Int) -> Void)?
    var onConnected: (() -> Void)?
    var onDisconnected: (() -> Void)?

    private var browser: NWBrowser?
    private var webSocket: URLSessionWebSocketTask?
    private let urlSession = URLSession(configuration: .default)
    private let clientId = UUID().uuidString
    private let sessionId: String
    private var connected = false
    private var intentionalClose = false

    init(sessionId: String) {
        self.sessionId = sessionId
    }

    // MARK: - Discovery

    func startDiscovery() {
        let params = NWParameters()
        params.includePeerToPeer = true

        browser = NWBrowser(for: .bonjour(type: "_termpod._tcp", domain: "local."), using: params)

        browser?.stateUpdateHandler = { _ in }

        browser?.browseResultsChangedHandler = { [weak self] results, _ in
            Task { @MainActor in
                self?.handleBrowseResults(results)
            }
        }

        browser?.start(queue: .main)
    }

    func stopDiscovery() {
        browser?.cancel()
        browser = nil
    }

    private func handleBrowseResults(_ results: Set<NWBrowser.Result>) {
        guard webSocket == nil else { return }

        for result in results {
            if case .service(_, _, _, _) = result.endpoint {
                resolve(result: result)
                return
            }
        }
    }

    private func resolve(result: NWBrowser.Result) {
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
                        // Strip interface scope suffix (e.g. "%en0")
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
                        self.connectWebSocket(host: hostStr, port: port.rawValue)
                    }
                }

                connection.cancel()
            }
        }

        connection.start(queue: .main)
    }

    // MARK: - WebSocket Connection

    private func connectWebSocket(host: String, port: UInt16) {
        guard let url = URL(string: "ws://\(host):\(port)") else { return }

        intentionalClose = false
        webSocket = urlSession.webSocketTask(with: url)
        webSocket?.resume()

        sendHello()
        startReceiving()
    }

    private func sendHello() {
        let hello: [String: Any] = [
            "type": "hello",
            "version": 1,
            "role": "viewer",
            "device": UIDevice.current.userInterfaceIdiom == .pad ? "ipad" : "iphone",
            "clientId": clientId,
            "sessionId": sessionId,
        ]

        guard let data = try? JSONSerialization.data(withJSONObject: hello),
              let str = String(data: data, encoding: .utf8)
        else { return }

        webSocket?.send(.string(str)) { _ in }
    }

    private func startReceiving() {
        webSocket?.receive { [weak self] result in
            guard let self else { return }

            switch result {
            case .success(let message):
                Task { @MainActor in
                    self.handleMessage(message)
                    self.startReceiving()
                }

            case .failure:
                Task { @MainActor in
                    self.handleDisconnect()
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
                onTerminalData?(Data(data.dropFirst()))
            case 0x02:
                let payload = data.dropFirst(5)
                onTerminalData?(Data(payload))
            default:
                break
            }

        case .string(let text):
            guard let jsonData = text.data(using: .utf8),
                  let json = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
                  let type = json["type"] as? String
            else { return }

            if type == "ready" {
                connected = true
                onConnected?()
            } else if type == "pty_resize" {
                if let cols = json["cols"] as? Int, let rows = json["rows"] as? Int {
                    onResize?(cols, rows)
                }
            }

        @unknown default:
            break
        }
    }

    private func handleDisconnect() {
        connected = false
        webSocket = nil

        if !intentionalClose {
            onDisconnected?()
        }
    }

    // MARK: - Transport

    func sendInput(_ data: Data) {
        var frame = Data([0x00])
        frame.append(data)
        webSocket?.send(.data(frame)) { _ in }
    }

    func sendResize(cols: Int, rows: Int) {
        var frame = Data(count: 5)
        frame[0] = 0x01
        frame[1] = UInt8((cols >> 8) & 0xFF)
        frame[2] = UInt8(cols & 0xFF)
        frame[3] = UInt8((rows >> 8) & 0xFF)
        frame[4] = UInt8(rows & 0xFF)
        webSocket?.send(.data(frame)) { _ in }
    }

    func disconnect() {
        intentionalClose = true
        stopDiscovery()
        webSocket?.cancel(with: .goingAway, reason: nil)
        webSocket = nil
        connected = false
    }
}
