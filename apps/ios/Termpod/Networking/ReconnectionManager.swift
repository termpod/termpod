import Foundation

/// Exponential backoff for WebSocket reconnection.
struct ReconnectionManager {

    struct Attempt {
        let number: Int
        let delay: Double
    }

    private var attemptCount = 0
    private let maxDelay: Double = 30
    private let baseDelay: Double = 1

    mutating func nextAttempt() -> Attempt {
        attemptCount += 1
        let delay = min(baseDelay * pow(2, Double(attemptCount - 1)), maxDelay)
        // Add jitter (0-25% of delay)
        let jitter = Double.random(in: 0...(delay * 0.25))
        return Attempt(number: attemptCount, delay: delay + jitter)
    }

    mutating func reset() {
        attemptCount = 0
    }
}
