import SwiftUI

// MARK: - Shimmer Modifier

struct ShimmerModifier: ViewModifier {

    @State private var phase: CGFloat = 0

    func body(content: Content) -> some View {
        content
            .overlay(
                LinearGradient(
                    colors: [.clear, .white.opacity(0.15), .clear],
                    startPoint: .leading,
                    endPoint: .trailing
                )
                .offset(x: phase)
                .mask(content)
            )
            .onAppear {
                withAnimation(.linear(duration: 1.5).repeatForever(autoreverses: false)) {
                    phase = 300
                }
            }
    }
}

extension View {
    func shimmer() -> some View {
        modifier(ShimmerModifier())
    }
}

// MARK: - Skeleton Device Row

struct SkeletonDeviceRow: View {

    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 6)
                .fill(Color(UIColor.systemGray5))
                .frame(width: 32, height: 32)

            VStack(alignment: .leading, spacing: 6) {
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color(UIColor.systemGray5))
                    .frame(width: 120, height: 14)

                RoundedRectangle(cornerRadius: 3)
                    .fill(Color(UIColor.systemGray6))
                    .frame(width: 80, height: 10)
            }

            Spacer()
        }
        .padding(.vertical, 4)
        .shimmer()
    }
}

// MARK: - Skeleton Session Card

struct SkeletonSessionCard: View {

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Terminal preview placeholder
            RoundedRectangle(cornerRadius: 2)
                .fill(Color(UIColor.systemGray6))
                .frame(height: 100)
                .clipShape(UnevenRoundedRectangle(topLeadingRadius: 10, topTrailingRadius: 10))

            // Info placeholder
            VStack(alignment: .leading, spacing: 6) {
                RoundedRectangle(cornerRadius: 4)
                    .fill(Color(UIColor.systemGray5))
                    .frame(width: 100, height: 12)

                RoundedRectangle(cornerRadius: 3)
                    .fill(Color(UIColor.systemGray6))
                    .frame(width: 70, height: 10)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
        }
        .background(Color(UIColor.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(Color(UIColor.separator).opacity(0.3), lineWidth: 0.5)
        )
        .shimmer()
    }
}
