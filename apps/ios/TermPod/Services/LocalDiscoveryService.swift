import Foundation
import Network
import UIKit

/// Discovers TermPod desktops on the local network via Bonjour
/// and maintains a persistent WebSocket connection to receive session updates.
@MainActor
final class LocalDiscoveryService: ObservableObject {

    struct LocalSession: Identifiable, Codable, Equatable {
        let id: String
        let name: String
        let cwd: String
        let processName: String?
        let ptyCols: Int
        let ptyRows: Int
    }

    @Published var sessions: [LocalSession] = []
    @Published var isDiscovered = false

    var onSessionCreated: ((_ requestId: String, _ sessionId: String, _ name: String, _ cwd: String, _ ptyCols: Int, _ ptyRows: Int) -> Void)?

    private var browser: NWBrowser?
    private var webSocket: URLSessionWebSocketTask?
    private let urlSession = URLSession(configuration: .default)
    private var resolvedHost: String?
    private var resolvedPort: UInt16?
    private var intentionalClose = false

    // MARK: - Discovery

    func start() {
        guard browser == nil else { return }

        intentionalClose = false

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

    func stop() {
        intentionalClose = true
        browser?.cancel()
        browser = nil
        webSocket?.cancel(with: .goingAway, reason: nil)
        webSocket = nil
        isDiscovered = false
        sessions = []
    }

    func refresh() async {
        guard webSocket != nil else { return }
        requestSessionList()
    }

    func sendCreateSessionRequest(requestId: String) {
        sendControlMessage(["type": "create_session_request", "requestId": requestId])
    }

    func sendDeleteSession(sessionId: String) {
        sendControlMessage(["type": "delete_session", "sessionId": sessionId])
    }

    private func sendControlMessage(_ msg: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: msg),
              let str = String(data: data, encoding: .utf8)
        else { return }

        webSocket?.send(.string(str)) { _ in }
    }

    // MARK: - Browse Results

    private func handleBrowseResults(_ results: Set<NWBrowser.Result>) {
        // If desktop disappears from Bonjour, mark offline
        if results.isEmpty {
            isDiscovered = false
            sessions = []
            webSocket?.cancel(with: .goingAway, reason: nil)
            webSocket = nil
            return
        }

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
                        self.isDiscovered = true
                        self.connectWebSocket()
                    }
                }

                connection.cancel()
            }
        }

        connection.start(queue: .main)
    }

    // MARK: - Persistent WebSocket

    private func connectWebSocket() {
        guard let host = resolvedHost, let port = resolvedPort,
              let url = URL(string: "ws://\(host):\(port)")
        else { return }

        webSocket?.cancel(with: .goingAway, reason: nil)

        let ws = urlSession.webSocketTask(with: url)
        webSocket = ws
        ws.resume()

        sendHello()
        startReceiving()
    }

    private func sendHello() {
        let hello: [String: Any] = [
            "type": "hello",
            "version": 1,
            "role": "viewer",
            "device": UIDevice.current.userInterfaceIdiom == .pad ? "ipad" : "iphone",
            "clientId": "discovery-\(UUID().uuidString)",
        ]

        guard let data = try? JSONSerialization.data(withJSONObject: hello),
              let str = String(data: data, encoding: .utf8)
        else { return }

        webSocket?.send(.string(str)) { _ in }
    }

    private func requestSessionList() {
        let request: [String: Any] = ["type": "list_sessions"]

        guard let data = try? JSONSerialization.data(withJSONObject: request),
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
        guard case .string(let text) = message,
              let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String
        else { return }

        switch type {
        case "ready":
            // Connected — request initial session list
            requestSessionList()

        case "sessions_list", "sessions_updated":
            guard let sessionsArray = json["sessions"] else { return }

            do {
                let sessionsData = try JSONSerialization.data(withJSONObject: sessionsArray)
                let decoded = try JSONDecoder().decode([LocalSession].self, from: sessionsData)
                self.sessions = decoded
            } catch {
                // Decode failed — ignore
            }

        case "session_created":
            if let requestId = json["requestId"] as? String,
               let sessionId = json["sessionId"] as? String,
               let name = json["name"] as? String,
               let cwd = json["cwd"] as? String,
               let ptyCols = json["ptyCols"] as? Int,
               let ptyRows = json["ptyRows"] as? Int {
                onSessionCreated?(requestId, sessionId, name, cwd, ptyCols, ptyRows)
            }

        default:
            break
        }
    }

    private func handleDisconnect() {
        webSocket = nil

        guard !intentionalClose else { return }

        isDiscovered = false
        sessions = []

        // Restart discovery to try reconnecting
        browser?.cancel()
        browser = nil

        Task {
            try? await Task.sleep(for: .seconds(2))
            guard !intentionalClose else { return }
            start()
        }
    }
}
