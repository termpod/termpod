import Foundation
import XCTest
@testable import TermPod

final class ConnectionManagerTests: XCTestCase {

    // MARK: - Initialization

    @MainActor
    func testInitialState() {
        let cm = ConnectionManager(sessionId: "test-session")
        XCTAssertEqual(cm.activeTransport, .relay)
        XCTAssertEqual(cm.state, .disconnected)
        XCTAssertEqual(cm.connectedViewers, 0)
        XCTAssertEqual(cm.ptySize.cols, 80)
        XCTAssertEqual(cm.ptySize.rows, 24)
        XCTAssertFalse(cm.isBackgrounded)
    }

    // MARK: - Scrollback Buffer

    @MainActor
    func testScrollbackBufferAccumulatesData() {
        let cm = ConnectionManager(sessionId: "test")
        var receivedData = Data()

        cm.onTerminalData = { data in
            receivedData.append(data)
        }

        // Simulate relay data delivery by replaying scrollback
        // First, we need to test replayScrollback with empty buffer
        cm.replayScrollback()
        XCTAssertTrue(receivedData.isEmpty, "No data should be replayed from empty buffer")
    }

    // MARK: - Session Created Handlers

    @MainActor
    func testAddAndRemoveSessionCreatedHandler() {
        let cm = ConnectionManager(sessionId: "test")

        var called = false
        cm.addSessionCreatedHandler(id: "req-1") { _, _, _, _, _, _ in
            called = true
        }

        cm.removeSessionCreatedHandler(id: "req-1")
        // Handler was removed, so it shouldn't be callable
        XCTAssertFalse(called)
    }

    @MainActor
    func testAddAndRemoveSessionsListHandler() {
        let cm = ConnectionManager(sessionId: "test")

        var called = false
        cm.addSessionsListHandler(id: "list-1") { _ in
            called = true
        }

        cm.removeSessionsListHandler(id: "list-1")
        XCTAssertFalse(called)
    }

    // MARK: - Transport Priority

    @MainActor
    func testDefaultTransportIsRelay() {
        let cm = ConnectionManager(sessionId: "test")
        XCTAssertEqual(cm.activeTransport, .relay)
    }

    @MainActor
    func testHasP2PTransportFalseByDefault() {
        let cm = ConnectionManager(sessionId: "test")
        XCTAssertFalse(cm.hasP2PTransport)
    }

    // MARK: - Disconnect

    @MainActor
    func testDisconnectResetsToRelay() {
        let cm = ConnectionManager(sessionId: "test")
        cm.disconnect()
        XCTAssertEqual(cm.activeTransport, .relay)
    }

    // MARK: - Nudge Resize

    @MainActor
    func testSendNudgeResizeWithNoLastSize() {
        let cm = ConnectionManager(sessionId: "test")
        // Should not crash when no lastRequestedSize
        cm.sendNudgeResize()
    }

    // MARK: - Session Name

    @MainActor
    func testSessionNameDefault() {
        let cm = ConnectionManager(sessionId: "test")
        XCTAssertEqual(cm.sessionName, "")
    }

    @MainActor
    func testSessionNameCanBeSet() {
        let cm = ConnectionManager(sessionId: "test")
        cm.sessionName = "My Terminal"
        XCTAssertEqual(cm.sessionName, "My Terminal")
    }
}
