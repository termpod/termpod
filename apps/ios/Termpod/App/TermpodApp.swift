import SwiftUI

@main
struct TermpodApp: App {

    @StateObject private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            SessionListView()
                .environmentObject(appState)
        }
    }
}
