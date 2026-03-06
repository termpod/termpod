import Foundation
import SwiftUI

@MainActor
final class AppState: ObservableObject {

    @Published var sessions: [Session] = []

    func pairWithToken(_ token: PairingToken) {
        let connection = ConnectionManager(sessionId: token.sessionId)
        let session = Session(
            id: UUID().uuidString,
            name: token.sessionName ?? "Terminal",
            connection: connection
        )

        sessions.append(session)
        connection.connect(wsURL: token.wsURL)
    }

    func removeSession(_ session: Session) {
        session.connection.disconnect()
        sessions.removeAll { $0.id == session.id }
    }
}
