import Foundation
import XCTest
@testable import TermPod

final class NotificationServiceTests: XCTestCase {

    @MainActor
    func testSharedInstanceIsSingleton() {
        let a = NotificationService.shared
        let b = NotificationService.shared
        XCTAssertTrue(a === b)
    }

    @MainActor
    func testClearPendingNotifications() {
        let service = NotificationService.shared
        // Should not crash
        service.clearPendingNotifications()
    }

    // Note: Full debouncing tests would require mocking UNUserNotificationCenter.
    // These tests verify the service initializes and basic methods don't crash.
}
