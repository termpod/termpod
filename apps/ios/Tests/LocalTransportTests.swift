import Foundation
import XCTest
@testable import TermPod

final class LocalTransportTests: XCTestCase {

    @MainActor
    func testTransportType() {
        let transport = LocalTransport(sessionId: "test")
        XCTAssertEqual(transport.transportType, .local)
    }

    @MainActor
    func testIsConnectedFalseWithoutDeviceTransport() {
        let transport = LocalTransport(sessionId: "test")
        XCTAssertFalse(transport.isConnected)
    }

    @MainActor
    func testDisconnectWithoutSubscription() {
        let transport = LocalTransport(sessionId: "test")
        // Should not crash
        transport.disconnect()
        XCTAssertFalse(transport.isConnected)
    }

    @MainActor
    func testStopDiscoveryIsNoOp() {
        let transport = LocalTransport(sessionId: "test")
        transport.stopDiscovery()
        // No crash = pass
    }

    @MainActor
    func testCallbacksAreNilByDefault() {
        let transport = LocalTransport(sessionId: "test")
        XCTAssertNil(transport.onTerminalData)
        XCTAssertNil(transport.onResize)
        XCTAssertNil(transport.onConnected)
        XCTAssertNil(transport.onDisconnected)
        XCTAssertNil(transport.onSessionCreated)
        XCTAssertNil(transport.onSessionsList)
        XCTAssertNil(transport.onSessionClosed)
    }

    @MainActor
    func testDeviceTransportIsWeakReference() {
        let transport = LocalTransport(sessionId: "test")
        XCTAssertNil(transport.deviceTransport)
    }

    @MainActor
    func testSendInputWithoutDeviceTransport() {
        let transport = LocalTransport(sessionId: "test")
        // Should not crash when deviceTransport is nil
        transport.sendInput(Data([0x41]))
    }

    @MainActor
    func testSendResizeWithoutDeviceTransport() {
        let transport = LocalTransport(sessionId: "test")
        // Should not crash when deviceTransport is nil
        transport.sendResize(cols: 80, rows: 24)
    }

    @MainActor
    func testSendControlMessageWithoutDeviceTransport() {
        let transport = LocalTransport(sessionId: "test")
        transport.sendControlMessage("{\"type\":\"list_sessions\"}")
        // No crash = pass
    }
}
