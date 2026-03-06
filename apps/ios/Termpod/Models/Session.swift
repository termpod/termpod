import Foundation

@MainActor
struct Session: Identifiable {

    let id: String
    var name: String
    let connection: ConnectionManager
    let createdAt: Date = .now

    var relay: RelayClient { connection.relay }

    var isConnected: Bool {
        connection.state == .live
    }
}
