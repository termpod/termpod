import Foundation
import XCTest
@testable import TermPod

/// Tests for transport type priority ordering and comparison.
final class TransportPriorityTests: XCTestCase {

    // MARK: - TransportType Ordering

    func testLocalIsHighestPriority() {
        XCTAssertLessThan(TransportType.local, TransportType.webrtc)
        XCTAssertLessThan(TransportType.local, TransportType.relay)
    }

    func testWebRTCIsMiddlePriority() {
        XCTAssertGreaterThan(TransportType.webrtc, TransportType.local)
        XCTAssertLessThan(TransportType.webrtc, TransportType.relay)
    }

    func testRelayIsLowestPriority() {
        XCTAssertGreaterThan(TransportType.relay, TransportType.local)
        XCTAssertGreaterThan(TransportType.relay, TransportType.webrtc)
    }

    func testTransportTypeEquality() {
        XCTAssertEqual(TransportType.local, TransportType.local)
        XCTAssertEqual(TransportType.webrtc, TransportType.webrtc)
        XCTAssertEqual(TransportType.relay, TransportType.relay)
        XCTAssertNotEqual(TransportType.local, TransportType.relay)
    }

    func testSortingOrder() {
        let unsorted: [TransportType] = [.relay, .local, .webrtc]
        let sorted = unsorted.sorted()
        XCTAssertEqual(sorted, [.local, .webrtc, .relay])
    }

    // MARK: - TransportType Labels

    func testTransportLabels() {
        XCTAssertEqual(TransportType.local.label, "Local")
        XCTAssertEqual(TransportType.webrtc.label, "P2P")
        XCTAssertEqual(TransportType.relay.label, "Relay")
    }

    // MARK: - Raw Values

    func testRawValues() {
        XCTAssertEqual(TransportType.local.rawValue, 0)
        XCTAssertEqual(TransportType.webrtc.rawValue, 1)
        XCTAssertEqual(TransportType.relay.rawValue, 2)
    }
}
