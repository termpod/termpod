import Foundation
import SwiftUI

@MainActor
final class AppState: ObservableObject {

    @Published var sessions: [Session] = []

    /// Pair via QR code (legacy / fallback). Optionally attaches auth token.
    func pairWithToken(_ token: PairingToken, auth: AuthService? = nil) {
        let wsURL: URL
        if let auth, let authURL = auth.authenticatedWSURL(sessionId: token.sessionId) {
            wsURL = authURL
        } else {
            wsURL = token.wsURL
        }

        let connection = ConnectionManager(sessionId: token.sessionId)
        let session = Session(
            id: UUID().uuidString,
            name: token.sessionName ?? "Terminal",
            connection: connection
        )

        sessions.append(session)
        connection.connect(wsURL: wsURL)
    }

    func removeSession(_ session: Session) {
        session.connection.disconnect()
        sessions.removeAll { $0.id == session.id }
    }
}
