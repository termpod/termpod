import Foundation
import SwiftUI

@MainActor
final class AppState: ObservableObject {

    @Published var sessions: [Session] = []

    func removeSession(_ session: Session) {
        print("[AppState] removeSession id=\(session.id), remaining=\(sessions.count - 1)")
        session.connection.disconnect()
        sessions.removeAll { $0.id == session.id }
    }
}
