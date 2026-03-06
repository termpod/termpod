import Foundation
import SwiftUI

@MainActor
final class AppState: ObservableObject {

    @Published var sessions: [Session] = []

    func pairWithToken(_ token: PairingToken) {
        let relay = RelayClient()
        let session = Session(
            id: UUID().uuidString,
            name: token.sessionName ?? "Terminal",
            relay: relay
        )

        sessions.append(session)
        relay.connect(wsURL: token.wsURL)
    }

    func removeSession(_ session: Session) {
        session.relay.disconnect()
        sessions.removeAll { $0.id == session.id }
    }
}
