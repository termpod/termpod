import Foundation

@MainActor
struct Session: Identifiable {

    let id: String
    var name: String
    let relay: RelayClient
    let createdAt: Date = .now

    var isConnected: Bool {
        relay.state == .live
    }
}
