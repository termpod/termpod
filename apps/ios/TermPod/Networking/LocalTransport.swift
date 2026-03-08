import Foundation

/// Local transport that delegates to DeviceTransportManager's multiplexed local WS connection.
///
/// Instead of owning its own Bonjour discovery and WebSocket, this now subscribes
/// to session data through the device-level connection, enabling multiple sessions
/// to share a single local WS.
@MainActor
final class LocalTransport: Transport {

    let transportType: TransportType = .local

    var isConnected: Bool { deviceTransport?.isLocalConnected ?? false }

    var onTerminalData: ((Data) -> Void)?
    var onResize: ((Int, Int) -> Void)?
    var onConnected: (() -> Void)?
    var onDisconnected: (() -> Void)?
    var onSessionCreated: ((_ requestId: String, _ sessionId: String, _ name: String, _ cwd: String, _ ptyCols: Int, _ ptyRows: Int) -> Void)?
    var onSessionsList: (([[String: Any]]) -> Void)?
    var onSessionClosed: (() -> Void)?

    weak var deviceTransport: DeviceTransportManager?

    private let sessionId: String
    private var subscribed = false

    init(sessionId: String) {
        self.sessionId = sessionId
    }

    // MARK: - Discovery / Subscription

    func startDiscovery() {
        guard !subscribed else { return }
        subscribed = true

        deviceTransport?.subscribeSession(
            sessionId: sessionId,
            onData: { [weak self] data in
                self?.onTerminalData?(data)
            },
            onResize: { [weak self] cols, rows in
                self?.onResize?(cols, rows)
            }
        )

        if deviceTransport?.isLocalConnected == true {
            onConnected?()
        }
    }

    func stopDiscovery() {
        // No-op — unsubscription happens in disconnect()
    }

    // MARK: - Transport

    func sendControlMessage(_ json: String) {
        guard let data = json.data(using: .utf8),
              let msg = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return }

        deviceTransport?.sendLocalControl(msg)
    }

    func sendInput(_ data: Data) {
        deviceTransport?.sendSessionInput(sessionId: sessionId, data: data)
    }

    func sendResize(cols: Int, rows: Int) {
        deviceTransport?.sendSessionResize(sessionId: sessionId, cols: cols, rows: rows)
    }

    func disconnect() {
        guard subscribed else { return }
        subscribed = false
        deviceTransport?.unsubscribeSession(sessionId: sessionId)
    }
}
