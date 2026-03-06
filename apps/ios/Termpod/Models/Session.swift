import Foundation

@MainActor
struct Session: Identifiable, Hashable {

    let id: String
    var name: String
    let connection: ConnectionManager
    let createdAt: Date = .now

    var relay: RelayClient { connection.relay }

    var isConnected: Bool {
        connection.state == .live
    }

    nonisolated func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    nonisolated static func == (lhs: Session, rhs: Session) -> Bool {
        lhs.id == rhs.id
    }
}
