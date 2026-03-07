import SwiftUI

@main
struct TermPodApp: App {

    @StateObject private var auth = AuthService()
    @StateObject private var appState = AppState()
    @StateObject private var deviceService = DeviceService()
    @StateObject private var settings = TerminalSettings()
    @Environment(\.scenePhase) private var scenePhase

    @AppStorage("hasSeenOnboarding") private var hasSeenOnboarding = false
    @State private var isLocked = false
    @State private var wasBackgrounded = false

    var body: some Scene {
        WindowGroup {
            ZStack {
                Group {
                    if !hasSeenOnboarding {
                        OnboardingView {
                            withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                                hasSeenOnboarding = true
                            }
                        }
                    } else if auth.isAuthenticated {
                        DeviceListView()
                            .environmentObject(deviceService)
                    } else {
                        LoginView()
                    }
                }
                .environmentObject(auth)
                .environmentObject(appState)
                .environmentObject(settings)

                if isLocked {
                    LockScreenView {
                        isLocked = false
                    }
                    .transition(.opacity)
                    .zIndex(100)
                }
            }
            .onChange(of: scenePhase) { _, phase in
                handleScenePhase(phase)
            }
        }
    }

    private func handleScenePhase(_ phase: ScenePhase) {
        switch phase {
        case .background:
            wasBackgrounded = true
            // Mark all sessions as backgrounded for notifications
            for session in appState.sessions {
                session.connection.isBackgrounded = true
            }

        case .active:
            // Bring sessions back to foreground
            for session in appState.sessions {
                session.connection.isBackgrounded = false
            }
            NotificationService.shared.clearPendingNotifications()

            // Biometric lock check
            if wasBackgrounded && settings.biometricLockEnabled {
                isLocked = true
            }
            wasBackgrounded = false

        case .inactive:
            break

        @unknown default:
            break
        }
    }
}
