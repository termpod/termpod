import Combine
import Foundation

/// Manages multiple transport connections and routes data through the best one.
///
/// Priority: local WebSocket > WebRTC > relay.
/// The relay always stays connected for signaling and as a fallback.
/// Input is sent through the best transport only.
/// Output is accepted from ALL transports — duplicates are harmless for
/// terminal rendering, and this avoids data loss during transport switches.
@MainActor
final class ConnectionManager: ObservableObject {

    @Published var activeTransport: TransportType = .relay
    @Published var state: RelayClient.ConnectionState = .disconnected
    @Published var connectedViewers: Int = 0
    @Published var ptySize: (cols: Int, rows: Int) = (80, 24)

    var onTerminalData: ((Data) -> Void)?
    var onResize: ((Int, Int) -> Void)?

    let relay: RelayClient
    private let localTransport: LocalTransport
    private let webrtcTransport: WebRTCTransport
    private let sessionId: String
    private var cancellables: Set<AnyCancellable> = []

    init(sessionId: String) {
        self.sessionId = sessionId
        self.relay = RelayClient()
        self.localTransport = LocalTransport(sessionId: sessionId)
        self.webrtcTransport = WebRTCTransport(clientId: UUID().uuidString)
        setupCallbacks()
    }

    // MARK: - Connection

    func connect(wsURL: URL) {
        print("[ConnectionManager] Connecting — relay: \(wsURL), starting local discovery")
        // Always connect relay (needed for signaling + fallback + initial scrollback)
        relay.connect(wsURL: wsURL)

        // Start local network discovery
        localTransport.startDiscovery()
    }

    func disconnect() {
        relay.disconnect()
        localTransport.disconnect()
        webrtcTransport.disconnect()
        activeTransport = .relay
    }

    // MARK: - Sending (through best transport only)

    func sendInput(_ data: Data) {
        bestTransport.sendInput(data)
    }

    func sendResize(cols: Int, rows: Int) {
        bestTransport.sendResize(cols: cols, rows: rows)
    }

    // MARK: - Private

    private var bestTransport: Transport {
        if localTransport.isConnected { return localTransport }
        if webrtcTransport.isConnected { return webrtcTransport }

        return relay
    }

    private func updateActiveTransport() {
        let previous = activeTransport

        if localTransport.isConnected {
            activeTransport = .local
        } else if webrtcTransport.isConnected {
            activeTransport = .webrtc
        } else {
            activeTransport = .relay
        }

        if activeTransport != previous {
            print("[ConnectionManager] Transport switched: \(previous.label) -> \(activeTransport.label)")
        }
    }

    private func setupCallbacks() {
        // Accept terminal output from ALL transports — duplicates are harmless
        // for terminal rendering, and this prevents data loss during transport
        // switches (e.g. relay delivers scrollback before local connects).
        relay.onTerminalData = { [weak self] data in
            self?.onTerminalData?(data)
        }

        relay.onResize = { [weak self] cols, rows in
            self?.ptySize = (cols, rows)
            self?.onResize?(cols, rows)
        }

        // Forward WebRTC signaling from relay (always needed)
        relay.onSignaling = { [weak self] json in
            self?.webrtcTransport.handleSignaling(json)
        }

        // Local transport callbacks
        localTransport.onTerminalData = { [weak self] data in
            self?.onTerminalData?(data)
        }

        localTransport.onResize = { [weak self] cols, rows in
            self?.ptySize = (cols, rows)
            self?.onResize?(cols, rows)
        }

        localTransport.onConnected = { [weak self] in
            self?.updateActiveTransport()
        }

        localTransport.onDisconnected = { [weak self] in
            self?.updateActiveTransport()
        }

        // WebRTC transport callbacks
        webrtcTransport.onTerminalData = { [weak self] data in
            self?.onTerminalData?(data)
        }

        webrtcTransport.onResize = { [weak self] cols, rows in
            self?.ptySize = (cols, rows)
            self?.onResize?(cols, rows)
        }

        webrtcTransport.onConnected = { [weak self] in
            self?.updateActiveTransport()
        }

        webrtcTransport.onDisconnected = { [weak self] in
            self?.updateActiveTransport()
        }

        webrtcTransport.sendSignaling = { [weak self] msg in
            self?.relay.sendSignaling(msg)
        }

        // Propagate relay state changes to this object
        relay.objectWillChange.sink { [weak self] _ in
            guard let self else { return }

            Task { @MainActor in
                self.state = self.relay.state
                self.connectedViewers = self.relay.connectedViewers
                self.ptySize = self.relay.ptySize
                self.objectWillChange.send()
            }
        }.store(in: &cancellables)
    }
}
