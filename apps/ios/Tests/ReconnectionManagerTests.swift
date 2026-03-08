import Foundation
import XCTest
@testable import TermPod

/// Tests for the ReconnectionManager exponential backoff logic.
final class ReconnectionManagerTests: XCTestCase {

    func testFirstAttemptHasBaseDelay() {
        var manager = ReconnectionManager()
        let attempt = manager.nextAttempt()

        XCTAssertEqual(attempt.number, 1)
        // Base delay is 1s + up to 25% jitter → [1.0, 1.25]
        XCTAssertGreaterThanOrEqual(attempt.delay, 1.0)
        XCTAssertLessThanOrEqual(attempt.delay, 1.25)
    }

    func testSecondAttemptDoublesDelay() {
        var manager = ReconnectionManager()
        _ = manager.nextAttempt() // 1s
        let attempt = manager.nextAttempt()

        XCTAssertEqual(attempt.number, 2)
        // 2s + up to 25% jitter → [2.0, 2.5]
        XCTAssertGreaterThanOrEqual(attempt.delay, 2.0)
        XCTAssertLessThanOrEqual(attempt.delay, 2.5)
    }

    func testExponentialBackoff() {
        var manager = ReconnectionManager()

        // Expected base delays: 1, 2, 4, 8, 16, 30 (capped)
        let expectedBases: [Double] = [1, 2, 4, 8, 16, 30]

        for (i, expectedBase) in expectedBases.enumerated() {
            let attempt = manager.nextAttempt()
            XCTAssertEqual(attempt.number, i + 1)
            XCTAssertGreaterThanOrEqual(attempt.delay, expectedBase)
            XCTAssertLessThanOrEqual(attempt.delay, expectedBase * 1.25)
        }
    }

    func testMaxDelayCap() {
        var manager = ReconnectionManager()

        // Do many attempts — should never exceed 30s * 1.25 = 37.5s
        for _ in 0..<20 {
            let attempt = manager.nextAttempt()
            XCTAssertLessThanOrEqual(attempt.delay, 37.5)
        }
    }

    func testResetResetsAttemptCount() {
        var manager = ReconnectionManager()
        _ = manager.nextAttempt()
        _ = manager.nextAttempt()
        _ = manager.nextAttempt()

        manager.reset()

        let attempt = manager.nextAttempt()
        XCTAssertEqual(attempt.number, 1)
        XCTAssertGreaterThanOrEqual(attempt.delay, 1.0)
        XCTAssertLessThanOrEqual(attempt.delay, 1.25)
    }

    func testAttemptNumberIncrementsMonotonically() {
        var manager = ReconnectionManager()

        for i in 1...10 {
            let attempt = manager.nextAttempt()
            XCTAssertEqual(attempt.number, i)
        }
    }

    func testJitterIsNonNegative() {
        var manager = ReconnectionManager()

        for _ in 0..<50 {
            let attempt = manager.nextAttempt()
            XCTAssertGreaterThanOrEqual(attempt.delay, 0)
            manager.reset()
        }
    }
}
