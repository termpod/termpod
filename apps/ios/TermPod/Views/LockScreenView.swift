import SwiftUI

struct LockScreenView: View {

    let onUnlocked: () -> Void
    @State private var authenticating = false

    var body: some View {
        ZStack {
            Color(UIColor.systemBackground)
                .ignoresSafeArea()

            VStack(spacing: 24) {
                Image(systemName: "terminal")
                    .font(.system(size: 48))
                    .foregroundStyle(.secondary)

                Text("TermPod")
                    .font(.title2)
                    .fontWeight(.semibold)

                Button {
                    authenticate()
                } label: {
                    Label("Unlock", systemImage: biometricIcon)
                        .font(.headline)
                        .frame(maxWidth: 200)
                }
                .buttonStyle(.borderedProminent)
                .disabled(authenticating)
            }
        }
        .task {
            authenticate()
        }
    }

    private var biometricIcon: String {
        switch BiometricService.biometryType {
        case .faceID: return "faceid"
        case .touchID: return "touchid"
        case .opticID: return "opticid"
        case .none: return "lock"
        @unknown default: return "lock"
        }
    }

    private func authenticate() {
        guard !authenticating else { return }
        authenticating = true

        Task {
            let success = await BiometricService.authenticate()
            authenticating = false
            if success {
                withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                    onUnlocked()
                }
            }
        }
    }
}
