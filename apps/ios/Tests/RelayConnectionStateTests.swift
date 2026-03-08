import Foundation
import XCTest
@testable import TermPod

/// Tests for RelayClient.ConnectionState properties.
final class RelayConnectionStateTests: XCTestCase {

    // MARK: - isTransient

    func testDisconnectedIsNotTransient() {
        let state = RelayClient.ConnectionState.disconnected
        XCTAssertFalse(state.isTransient)
    }

    func testConnectingIsTransient() {
        let state = RelayClient.ConnectionState.connecting
        XCTAssertTrue(state.isTransient)
    }

    func testConnectedIsNotTransient() {
        let state = RelayClient.ConnectionState.connected
        XCTAssertFalse(state.isTransient)
    }

    func testLoadingScrollbackIsTransient() {
        let state = RelayClient.ConnectionState.loadingScrollback
        XCTAssertTrue(state.isTransient)
    }

    func testLiveIsNotTransient() {
        let state = RelayClient.ConnectionState.live
        XCTAssertFalse(state.isTransient)
    }

    func testReconnectingIsTransient() {
        let state = RelayClient.ConnectionState.reconnecting(attempt: 1)
        XCTAssertTrue(state.isTransient)

        let state2 = RelayClient.ConnectionState.reconnecting(attempt: 5)
        XCTAssertTrue(state2.isTransient)
    }

    // MARK: - Equatable

    func testStateEquality() {
        XCTAssertEqual(RelayClient.ConnectionState.disconnected, .disconnected)
        XCTAssertEqual(RelayClient.ConnectionState.connecting, .connecting)
        XCTAssertEqual(RelayClient.ConnectionState.connected, .connected)
        XCTAssertEqual(RelayClient.ConnectionState.loadingScrollback, .loadingScrollback)
        XCTAssertEqual(RelayClient.ConnectionState.live, .live)
        XCTAssertEqual(RelayClient.ConnectionState.reconnecting(attempt: 3), .reconnecting(attempt: 3))
    }

    func testStateInequality() {
        XCTAssertNotEqual(RelayClient.ConnectionState.disconnected, .live)
        XCTAssertNotEqual(RelayClient.ConnectionState.connecting, .connected)
        XCTAssertNotEqual(RelayClient.ConnectionState.reconnecting(attempt: 1), .reconnecting(attempt: 2))
    }
}
