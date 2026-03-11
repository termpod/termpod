import Foundation
import SwiftUI

@MainActor
final class AppState: ObservableObject {

    @Published var sessions: [Session] = []

    /// Device-level transport manager — persists across all screens.
    let deviceTransport = DeviceTransportManager()

    init() {
        deviceTransport.onDesktopDisconnected = { [weak self] in
            guard let self else { return }
            for session in self.sessions {
                session.connection.onSessionClosed?()
            }
        }
    }

    func removeSession(_ session: Session) {
        session.connection.disconnect()
        sessions.removeAll { $0.id == session.id }
    }

    /// Verify all transports are alive after returning from background.
    func reconnectIfNeeded() {
        deviceTransport.reconnectIfNeeded()

        for session in sessions {
            session.connection.reconnectIfNeeded()
        }
    }
}
