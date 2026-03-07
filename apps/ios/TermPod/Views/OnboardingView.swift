import SwiftUI

struct OnboardingView: View {

    let onComplete: () -> Void
    @State private var currentPage = 0

    var body: some View {
        VStack(spacing: 0) {
            TabView(selection: $currentPage) {
                onboardingPage(
                    icon: "terminal",
                    title: "Your Terminal, Everywhere",
                    subtitle: "Access your Mac's terminal sessions from your iPhone in real time.",
                    color: .blue
                )
                .tag(0)

                onboardingPage(
                    icon: "bolt.horizontal",
                    title: "Connect Instantly",
                    subtitle: "Direct local connection over your network for the lowest latency. Cloud relay as automatic fallback.",
                    color: .green
                )
                .tag(1)

                onboardingPage(
                    icon: "hand.tap",
                    title: "Built for Touch",
                    subtitle: "Special keys bar, pinch to zoom, gesture navigation, and customizable themes.",
                    color: .purple
                )
                .tag(2)
            }
            .tabViewStyle(.page(indexDisplayMode: .always))
            .indexViewStyle(.page(backgroundDisplayMode: .always))

            // Bottom button
            Button {
                if currentPage < 2 {
                    withAnimation(.spring(response: 0.4, dampingFraction: 0.8)) {
                        currentPage += 1
                    }
                } else {
                    onComplete()
                }
            } label: {
                Text(currentPage < 2 ? "Continue" : "Get Started")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
            }
            .buttonStyle(.borderedProminent)
            .padding(.horizontal, 32)
            .padding(.bottom, 24)

            if currentPage < 2 {
                Button("Skip") {
                    onComplete()
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .padding(.bottom, 16)
            } else {
                Spacer()
                    .frame(height: 40)
            }
        }
        .background(Color(UIColor.systemBackground))
    }

    private func onboardingPage(
        icon: String,
        title: String,
        subtitle: String,
        color: Color
    ) -> some View {
        VStack(spacing: 20) {
            Spacer()

            ZStack {
                Circle()
                    .fill(color.opacity(0.12))
                    .frame(width: 120, height: 120)

                Image(systemName: icon)
                    .font(.system(size: 48, weight: .light))
                    .foregroundStyle(color)
            }

            Text(title)
                .font(.title)
                .fontWeight(.bold)
                .multilineTextAlignment(.center)

            Text(subtitle)
                .font(.body)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
                .fixedSize(horizontal: false, vertical: true)

            Spacer()
            Spacer()
        }
    }
}
