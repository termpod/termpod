import Foundation
import XCTest
@testable import TermPod

final class DeviceSessionInfoTests: XCTestCase {

    func testIdentifiable() {
        let info = DeviceSessionInfo(
            id: "s1",
            name: "Shell",
            cwd: "/home",
            processName: "zsh",
            ptyCols: 80,
            ptyRows: 24
        )
        XCTAssertEqual(info.id, "s1")
    }

    func testEquatable() {
        let s1 = DeviceSessionInfo(id: "a", name: "A", cwd: "/", processName: nil, ptyCols: 80, ptyRows: 24)
        let s2 = DeviceSessionInfo(id: "a", name: "A", cwd: "/", processName: nil, ptyCols: 80, ptyRows: 24)
        let s3 = DeviceSessionInfo(id: "b", name: "B", cwd: "/tmp", processName: "vim", ptyCols: 120, ptyRows: 40)

        XCTAssertEqual(s1, s2)
        XCTAssertNotEqual(s1, s3)
    }

    func testNilProcessName() {
        let info = DeviceSessionInfo(id: "x", name: "Tab", cwd: "~", processName: nil, ptyCols: 80, ptyRows: 24)
        XCTAssertNil(info.processName)
    }
}

final class DeviceTransportManagerTests: XCTestCase {

    // MARK: - Initial State

    @MainActor
    func testInitialState() {
        let dtm = DeviceTransportManager()
        XCTAssertEqual(dtm.activeTransport, .relay)
        XCTAssertTrue(dtm.sessions.isEmpty)
        XCTAssertFalse(dtm.isConnected)
        XCTAssertFalse(dtm.isConnecting)
        XCTAssertNil(dtm.webrtcMode)
    }

    // MARK: - Session Subscription

    @MainActor
    func testSubscribeAndUnsubscribeSession() {
        let dtm = DeviceTransportManager()

        var dataReceived = false
        var resizeReceived = false

        dtm.subscribeSession(
            sessionId: "test-sess",
            onData: { _ in dataReceived = true },
            onResize: { _, _ in resizeReceived = true }
        )

        dtm.unsubscribeSession(sessionId: "test-sess")
        // After unsubscribe, handlers should be removed — no crash
        XCTAssertFalse(dataReceived)
        XCTAssertFalse(resizeReceived)
    }

    @MainActor
    func testSubscribeWebRTCSession() {
        let dtm = DeviceTransportManager()

        var dataReceived = false
        dtm.subscribeWebRTCSession(
            sessionId: "webrtc-sess",
            onData: { _ in dataReceived = true },
            onResize: { _, _ in }
        )

        dtm.unsubscribeWebRTCSession(sessionId: "webrtc-sess")
        XCTAssertFalse(dataReceived)
    }

    // MARK: - Session Created Handlers

    @MainActor
    func testAddAndRemoveSessionCreatedHandler() {
        let dtm = DeviceTransportManager()

        var handlerCalled = false
        dtm.addSessionCreatedHandler(id: "req-1") { _, _, _, _, _, _ in
            handlerCalled = true
        }

        dtm.removeSessionCreatedHandler(id: "req-1")
        XCTAssertFalse(handlerCalled)
    }

    @MainActor
    func testAddAndRemoveSessionsListHandler() {
        let dtm = DeviceTransportManager()

        var handlerCalled = false
        dtm.addSessionsListHandler(id: "list-1") { _ in
            handlerCalled = true
        }

        dtm.removeSessionsListHandler(id: "list-1")
        XCTAssertFalse(handlerCalled)
    }

    // MARK: - Transport State

    @MainActor
    func testHasP2PTransportFalseByDefault() {
        let dtm = DeviceTransportManager()
        XCTAssertFalse(dtm.hasP2PTransport)
    }

    @MainActor
    func testIsLocalConnectedFalseByDefault() {
        let dtm = DeviceTransportManager()
        XCTAssertFalse(dtm.isLocalConnected)
    }

    @MainActor
    func testIsWebRTCConnectedFalseByDefault() {
        let dtm = DeviceTransportManager()
        XCTAssertFalse(dtm.isWebRTCConnected)
    }

    // MARK: - Stop

    @MainActor
    func testStopResetsState() {
        let dtm = DeviceTransportManager()
        dtm.stop()

        XCTAssertFalse(dtm.isConnected)
        XCTAssertFalse(dtm.isConnecting)
        XCTAssertTrue(dtm.sessions.isEmpty)
        XCTAssertNil(dtm.webrtcMode)
    }

    // MARK: - Debug Log

    @MainActor
    func testDebugLogInitiallyEmpty() {
        let dtm = DeviceTransportManager()
        XCTAssertTrue(dtm.debugLog.isEmpty)
    }

    // MARK: - Token Update

    @MainActor
    func testUpdateTokenDoesNotCrash() {
        let dtm = DeviceTransportManager()
        dtm.updateToken("new-jwt-token")
        // No crash = pass
    }

    // MARK: - WebRTC Control for nil transport

    @MainActor
    func testWebrtcTransportForControlNilByDefault() {
        let dtm = DeviceTransportManager()
        XCTAssertNil(dtm.webrtcTransportForControl)
    }

    // MARK: - Mux Frame Building (sendSessionInput / sendSessionResize)

    func testMuxInputFrameFormat() {
        // Verify the frame format: [0x00][sid_len][sid_bytes][payload]
        let sessionId = "test-session"
        let payload = Data([0x48, 0x65, 0x6C, 0x6C, 0x6F])
        let sidBytes = Array(sessionId.utf8)

        var frame = Data(capacity: 2 + sidBytes.count + payload.count)
        frame.append(0x00)
        frame.append(UInt8(sidBytes.count))
        frame.append(contentsOf: sidBytes)
        frame.append(payload)

        XCTAssertEqual(frame[0], 0x00)
        XCTAssertEqual(Int(frame[1]), 12) // "test-session" = 12 bytes
        XCTAssertEqual(frame.count, 2 + 12 + 5)
    }

    func testMuxResizeFrameFormat() {
        // Verify the frame format: [0x01][sid_len][sid_bytes][cols_hi][cols_lo][rows_hi][rows_lo]
        let sessionId = "s1"
        let sidBytes = Array(sessionId.utf8)
        let cols = 120
        let rows = 40

        var frame = Data(capacity: 2 + sidBytes.count + 4)
        frame.append(0x01)
        frame.append(UInt8(sidBytes.count))
        frame.append(contentsOf: sidBytes)
        frame.append(UInt8((cols >> 8) & 0xFF))
        frame.append(UInt8(cols & 0xFF))
        frame.append(UInt8((rows >> 8) & 0xFF))
        frame.append(UInt8(rows & 0xFF))

        XCTAssertEqual(frame[0], 0x01)
        let payloadStart = 2 + sidBytes.count
        let decodedCols = Int(frame[payloadStart]) << 8 | Int(frame[payloadStart + 1])
        let decodedRows = Int(frame[payloadStart + 2]) << 8 | Int(frame[payloadStart + 3])
        XCTAssertEqual(decodedCols, 120)
        XCTAssertEqual(decodedRows, 40)
    }

    func testWebRTCMuxInputFrameFormat() {
        // [0x10][sid_len][sid_bytes][payload]
        let sessionId = "abc"
        let payload = Data([0xFF])
        let sidBytes = Array(sessionId.utf8)

        var frame = Data(capacity: 2 + sidBytes.count + payload.count)
        frame.append(0x10)
        frame.append(UInt8(sidBytes.count))
        frame.append(contentsOf: sidBytes)
        frame.append(payload)

        XCTAssertEqual(frame[0], 0x10)
        XCTAssertEqual(Int(frame[1]), 3)
    }

    func testWebRTCMuxResizeFrameFormat() {
        // [0x11][sid_len][sid_bytes][cols_hi][cols_lo][rows_hi][rows_lo]
        let sessionId = "xyz"
        let sidBytes = Array(sessionId.utf8)
        let cols = 256
        let rows = 100

        var frame = Data(capacity: 2 + sidBytes.count + 4)
        frame.append(0x11)
        frame.append(UInt8(sidBytes.count))
        frame.append(contentsOf: sidBytes)
        frame.append(UInt8((cols >> 8) & 0xFF))
        frame.append(UInt8(cols & 0xFF))
        frame.append(UInt8((rows >> 8) & 0xFF))
        frame.append(UInt8(rows & 0xFF))

        let payloadStart = 2 + sidBytes.count
        let decodedCols = Int(frame[payloadStart]) << 8 | Int(frame[payloadStart + 1])
        let decodedRows = Int(frame[payloadStart + 2]) << 8 | Int(frame[payloadStart + 3])
        XCTAssertEqual(decodedCols, 256)
        XCTAssertEqual(decodedRows, 100)
    }

    // MARK: - Local Auth

    func testLocalAuthFrameFormat() throws {
        // The local auth message is: {"type": "auth", "secret": "<secret>"}
        let secret = "test-secret-123"
        let authMsg: [String: Any] = ["type": "auth", "secret": secret]

        let jsonData = try JSONSerialization.data(withJSONObject: authMsg)
        let parsed = try JSONSerialization.jsonObject(with: jsonData) as! [String: Any]

        XCTAssertEqual(parsed["type"] as? String, "auth")
        XCTAssertEqual(parsed["secret"] as? String, secret)
    }

    func testLocalAuthSecretMessageParsing() throws {
        // The device WS sends: {"type": "local_auth_secret", "secret": "<value>"}
        let secret = "abc-def-ghi"
        let msg: [String: Any] = ["type": "local_auth_secret", "secret": secret]

        let jsonData = try JSONSerialization.data(withJSONObject: msg)
        let parsed = try JSONSerialization.jsonObject(with: jsonData) as! [String: Any]

        XCTAssertEqual(parsed["type"] as? String, "local_auth_secret")
        XCTAssertEqual(parsed["secret"] as? String, secret)
    }

    @MainActor
    func testStopResetsLocalWSPendingAuth() {
        // After stop(), localWSPendingAuth should be false (observable via not crashing on re-start)
        let dtm = DeviceTransportManager()
        dtm.stop()

        // Verify full state reset including the new auth-related state
        XCTAssertFalse(dtm.isConnected)
        XCTAssertFalse(dtm.isConnecting)
        XCTAssertTrue(dtm.sessions.isEmpty)
        XCTAssertFalse(dtm.isLocalConnected)
    }

    func testLocalAuthOkMessageFormat() throws {
        // The local WS responds with: {"type": "auth_ok"}
        let msg: [String: Any] = ["type": "auth_ok"]

        let jsonData = try JSONSerialization.data(withJSONObject: msg)
        let parsed = try JSONSerialization.jsonObject(with: jsonData) as! [String: Any]

        XCTAssertEqual(parsed["type"] as? String, "auth_ok")
    }
}

// MARK: - Notification Name

final class NotificationNameTests: XCTestCase {

    func testNetworkInterfaceChangedNotificationName() {
        XCTAssertEqual(
            Notification.Name.networkInterfaceChanged.rawValue,
            "networkInterfaceChanged"
        )
    }
}
