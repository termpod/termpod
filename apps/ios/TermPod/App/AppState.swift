import Foundation
import SwiftUI

@MainActor
final class AppState: ObservableObject {

    @Published var sessions: [Session] = []

    func removeSession(_ session: Session) {
        session.connection.disconnect()
        sessions.removeAll { $0.id == session.id }
    }
}
