import Foundation

/// Priority order: local is best, then WebRTC, then relay.
enum TransportType: Int, Comparable {
    case local = 0
    case webrtc = 1
    case relay = 2

    static func < (lhs: TransportType, rhs: TransportType) -> Bool {
        lhs.rawValue < rhs.rawValue
    }

    var label: String {
        switch self {
        case .local: return "Local"
        case .webrtc: return "P2P"
        case .relay: return "Relay"
        }
    }
}

/// Common interface for all transport implementations.
@MainActor
protocol Transport: AnyObject {
    var transportType: TransportType { get }
    var isConnected: Bool { get }

    var onTerminalData: ((Data) -> Void)? { get set }
    var onResize: ((Int, Int) -> Void)? { get set }
    var onConnected: (() -> Void)? { get set }
    var onDisconnected: (() -> Void)? { get set }

    func sendInput(_ data: Data)
    func sendResize(cols: Int, rows: Int)
    func disconnect()
}
