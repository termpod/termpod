import UserNotifications

@MainActor
final class NotificationService {

    static let shared = NotificationService()

    private var lastNotificationTime: [String: Date] = [:]
    private let debounceInterval: TimeInterval = 5

    private init() {}

    func requestPermission() {
        Task {
            let center = UNUserNotificationCenter.current()
            _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
        }
    }

    func notifyBackgroundOutput(sessionName: String, sessionId: String) {
        let now = Date()

        if let lastTime = lastNotificationTime[sessionId],
           now.timeIntervalSince(lastTime) < debounceInterval {
            return
        }

        lastNotificationTime[sessionId] = now

        let content = UNMutableNotificationContent()
        content.title = "Terminal Activity"
        content.body = "Session '\(sessionName)' has new output"
        content.sound = .default
        content.threadIdentifier = sessionId

        let request = UNNotificationRequest(
            identifier: "output-\(sessionId)-\(UUID().uuidString)",
            content: content,
            trigger: nil
        )

        Task {
            try? await UNUserNotificationCenter.current().add(request)
        }
    }

    func clearPendingNotifications() {
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
        lastNotificationTime.removeAll()
    }
}
