import SwiftUI

@main
struct TermpodApp: App {

    @StateObject private var auth = AuthService()
    @StateObject private var appState = AppState()
    @StateObject private var deviceService = DeviceService()

    var body: some Scene {
        WindowGroup {
            Group {
                if auth.isAuthenticated {
                    DeviceListView()
                        .environmentObject(deviceService)
                } else {
                    LoginView()
                }
            }
            .environmentObject(auth)
            .environmentObject(appState)
        }
    }
}
