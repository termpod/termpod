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
        relay.connect(wsURL: wsURL)
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

    /// Track the last size this mobile client requested so we can
    /// re-send it when the active transport changes.
    private var lastRequestedSize: (cols: Int, rows: Int)?

    func sendResize(cols: Int, rows: Int) {
        lastRequestedSize = (cols, rows)
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

    private func setupCallbacks() {
        // Relay output — accepted during scrollback phase, filtered once live
        relay.onTerminalData = { [weak self] data in
            guard let self, self.shouldAcceptData(from: .relay) else { return }
            self.onTerminalData?(data)
        }

        relay.onResize = { [weak self] cols, rows in
            self?.ptySize = (cols, rows)
            self?.onResize?(cols, rows)
        }

        // Forward WebRTC signaling from relay (always needed)
        relay.onSignaling = { [weak self] json in
            self?.webrtcTransport.handleSignaling(json)
        }

        // Local transport callbacks — accepted when local is active
        localTransport.onTerminalData = { [weak self] data in
            guard let self, self.shouldAcceptData(from: .local) else { return }
            self.onTerminalData?(data)
        }

        localTransport.onResize = { [weak self] cols, rows in
            self?.ptySize = (cols, rows)
            self?.onResize?(cols, rows)
        }

        localTransport.onConnected = { [weak self] in
            guard let self else { return }
            self.updateActiveTransport()
            // Re-send mobile dimensions after a short delay so the PTY
            // adapts after the desktop's relay nudge-resize (50ms timeout).
            if let size = self.lastRequestedSize {
                Task {
                    try? await Task.sleep(for: .milliseconds(150))
                    self.bestTransport.sendResize(cols: size.cols, rows: size.rows)
                }
            }
        }

        localTransport.onDisconnected = { [weak self] in
            self?.updateActiveTransport()
        }

        // WebRTC transport callbacks — accepted when WebRTC is active
        webrtcTransport.onTerminalData = { [weak self] data in
            guard let self, self.shouldAcceptData(from: .webrtc) else { return }
            self.onTerminalData?(data)
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
