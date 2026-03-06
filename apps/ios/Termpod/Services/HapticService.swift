import UIKit

final class HapticService {

    static let shared = HapticService()

    private let bellGenerator = UINotificationFeedbackGenerator()
    private let tapGenerator = UIImpactFeedbackGenerator(style: .light)

    private init() {
        bellGenerator.prepare()
        tapGenerator.prepare()
    }

    func playBell() {
        bellGenerator.notificationOccurred(.warning)
    }

    func playTap() {
        tapGenerator.impactOccurred()
    }
}
