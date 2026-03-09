import Foundation
import XCTest
@testable import TermPod

// MARK: - WebRTCConnectionMode

final class WebRTCConnectionModeTests: XCTestCase {

    func testRawValues() {
        XCTAssertEqual(WebRTCConnectionMode.direct.rawValue, "Direct")
        XCTAssertEqual(WebRTCConnectionMode.stun.rawValue, "STUN")
        XCTAssertEqual(WebRTCConnectionMode.turn.rawValue, "TURN")
    }

    func testInitFromRawValue() {
        XCTAssertEqual(WebRTCConnectionMode(rawValue: "Direct"), .direct)
        XCTAssertEqual(WebRTCConnectionMode(rawValue: "STUN"), .stun)
        XCTAssertEqual(WebRTCConnectionMode(rawValue: "TURN"), .turn)
        XCTAssertNil(WebRTCConnectionMode(rawValue: "invalid"))
    }
}

// MARK: - WebRTCTransport (Stub or real, depending on build)

final class WebRTCTransportTests: XCTestCase {

    @MainActor
    func testTransportType() {
        let transport = WebRTCTransport(clientId: "test-client")
        XCTAssertEqual(transport.transportType, .webrtc)
    }

    @MainActor
    func testIsConnectedFalseByDefault() {
        let transport = WebRTCTransport(clientId: "test-client")
        XCTAssertFalse(transport.isConnected)
    }

    @MainActor
    func testDisconnectDoesNotCrash() {
        let transport = WebRTCTransport(clientId: "test-client")
        transport.disconnect()
        XCTAssertFalse(transport.isConnected)
    }

    @MainActor
    func testCallbacksNilByDefault() {
        let transport = WebRTCTransport(clientId: "test-client")
        XCTAssertNil(transport.onTerminalData)
        XCTAssertNil(transport.onResize)
        XCTAssertNil(transport.onMuxData)
        XCTAssertNil(transport.onConnected)
        XCTAssertNil(transport.onDisconnected)
        XCTAssertNil(transport.onControlMessage)
        XCTAssertNil(transport.sendSignaling)
    }

    @MainActor
    func testIceServerConfigsNilByDefault() {
        let transport = WebRTCTransport(clientId: "test-client")
        XCTAssertNil(transport.iceServerConfigs)
    }

    @MainActor
    func testSetIceServerConfigs() {
        let transport = WebRTCTransport(clientId: "test-client")
        let configs: [[String: Any]] = [
            ["urls": ["stun:stun.example.com:3478"]],
            ["urls": ["turn:turn.example.com:3478"], "username": "user", "credential": "pass"],
        ]
        transport.iceServerConfigs = configs
        XCTAssertNotNil(transport.iceServerConfigs)
        XCTAssertEqual(transport.iceServerConfigs?.count, 2)
    }

    @MainActor
    func testSendInputWithoutConnection() {
        let transport = WebRTCTransport(clientId: "test-client")
        // Should not crash when not connected
        transport.sendInput(Data([0x41, 0x42]))
    }

    @MainActor
    func testSendResizeWithoutConnection() {
        let transport = WebRTCTransport(clientId: "test-client")
        transport.sendResize(cols: 80, rows: 24)
        // No crash = pass
    }

    @MainActor
    func testSendControlMessageWithoutConnection() {
        let transport = WebRTCTransport(clientId: "test-client")
        transport.sendControlMessage(["type": "list_sessions"])
        // No crash = pass
    }

    @MainActor
    func testSendRawDataWithoutConnection() {
        let transport = WebRTCTransport(clientId: "test-client")
        transport.sendRawData(Data([0x10, 0x03, 0x61, 0x62, 0x63, 0xFF]))
        // No crash = pass
    }

    @MainActor
    func testHandleSignalingUnknownType() {
        let transport = WebRTCTransport(clientId: "test-client")
        // Unknown type should be ignored
        transport.handleSignaling(["type": "unknown_signal"])
        XCTAssertFalse(transport.isConnected)
    }

    @MainActor
    func testHandleSignalingMissingType() {
        let transport = WebRTCTransport(clientId: "test-client")
        transport.handleSignaling(["sdp": "some-sdp"])
        XCTAssertFalse(transport.isConnected)
    }
}
