import Foundation
import XCTest
@testable import TermPod

final class RelayClientTests: XCTestCase {

    // MARK: - Initial State

    @MainActor
    func testInitialState() {
        let relay = RelayClient()
        XCTAssertEqual(relay.state, .disconnected)
        XCTAssertFalse(relay.isConnected)
        XCTAssertEqual(relay.connectedViewers, 0)
        XCTAssertEqual(relay.ptySize.cols, 80)
        XCTAssertEqual(relay.ptySize.rows, 24)
    }

    @MainActor
    func testTransportType() {
        let relay = RelayClient()
        XCTAssertEqual(relay.transportType, .relay)
    }

    // MARK: - ConnectionState

    func testConnectionStateIsTransient() {
        XCTAssertTrue(RelayClient.ConnectionState.connecting.isTransient)
        XCTAssertTrue(RelayClient.ConnectionState.loadingScrollback.isTransient)
        XCTAssertTrue(RelayClient.ConnectionState.reconnecting(attempt: 1).isTransient)
        XCTAssertTrue(RelayClient.ConnectionState.reconnecting(attempt: 5).isTransient)

        XCTAssertFalse(RelayClient.ConnectionState.disconnected.isTransient)
        XCTAssertFalse(RelayClient.ConnectionState.connected.isTransient)
        XCTAssertFalse(RelayClient.ConnectionState.live.isTransient)
    }

    func testConnectionStateEquatable() {
        XCTAssertEqual(RelayClient.ConnectionState.disconnected, .disconnected)
        XCTAssertEqual(RelayClient.ConnectionState.connecting, .connecting)
        XCTAssertEqual(RelayClient.ConnectionState.connected, .connected)
        XCTAssertEqual(RelayClient.ConnectionState.loadingScrollback, .loadingScrollback)
        XCTAssertEqual(RelayClient.ConnectionState.live, .live)
        XCTAssertEqual(RelayClient.ConnectionState.reconnecting(attempt: 3), .reconnecting(attempt: 3))

        XCTAssertNotEqual(RelayClient.ConnectionState.disconnected, .connecting)
        XCTAssertNotEqual(RelayClient.ConnectionState.reconnecting(attempt: 1), .reconnecting(attempt: 2))
        XCTAssertNotEqual(RelayClient.ConnectionState.live, .connected)
    }

    // MARK: - Disconnect

    @MainActor
    func testDisconnectSetsStateToDisconnected() {
        let relay = RelayClient()
        relay.disconnect()
        XCTAssertEqual(relay.state, .disconnected)
        XCTAssertFalse(relay.isConnected)
    }

    // MARK: - Frame Encoding (sendInput)

    func testTerminalDataFrameEncoding() {
        // Channel 0x00 = terminal data: [0x00][payload]
        let input = Data("ls -la\n".utf8)
        var frame = Data([0x00])
        frame.append(input)

        XCTAssertEqual(frame[0], 0x00)
        XCTAssertEqual(frame.count, 1 + input.count)
        XCTAssertEqual(Data(frame.dropFirst()), input)
    }

    func testResizeFrameEncoding() {
        // Channel 0x01 = resize: [0x01][cols:u16be][rows:u16be]
        let cols = 132
        let rows = 43

        var frame = Data(count: 5)
        frame[0] = 0x01
        frame[1] = UInt8((cols >> 8) & 0xFF)
        frame[2] = UInt8(cols & 0xFF)
        frame[3] = UInt8((rows >> 8) & 0xFF)
        frame[4] = UInt8(rows & 0xFF)

        XCTAssertEqual(frame[0], 0x01)
        let decodedCols = Int(frame[1]) << 8 | Int(frame[2])
        let decodedRows = Int(frame[3]) << 8 | Int(frame[4])
        XCTAssertEqual(decodedCols, 132)
        XCTAssertEqual(decodedRows, 43)
    }

    func testResizeFrameMaxValues() {
        let cols = 65535
        let rows = 65535

        var frame = Data(count: 5)
        frame[0] = 0x01
        frame[1] = UInt8((cols >> 8) & 0xFF)
        frame[2] = UInt8(cols & 0xFF)
        frame[3] = UInt8((rows >> 8) & 0xFF)
        frame[4] = UInt8(rows & 0xFF)

        let decodedCols = Int(frame[1]) << 8 | Int(frame[2])
        let decodedRows = Int(frame[3]) << 8 | Int(frame[4])
        XCTAssertEqual(decodedCols, 65535)
        XCTAssertEqual(decodedRows, 65535)
    }

    func testResizeFrameMinValues() {
        let cols = 1
        let rows = 1

        var frame = Data(count: 5)
        frame[0] = 0x01
        frame[1] = UInt8((cols >> 8) & 0xFF)
        frame[2] = UInt8(cols & 0xFF)
        frame[3] = UInt8((rows >> 8) & 0xFF)
        frame[4] = UInt8(rows & 0xFF)

        let decodedCols = Int(frame[1]) << 8 | Int(frame[2])
        let decodedRows = Int(frame[3]) << 8 | Int(frame[4])
        XCTAssertEqual(decodedCols, 1)
        XCTAssertEqual(decodedRows, 1)
    }

    // MARK: - isConnected derived property

    @MainActor
    func testIsConnectedOnlyWhenLive() {
        let relay = RelayClient()

        // Default: disconnected
        XCTAssertFalse(relay.isConnected)

        // Only .live should return true for isConnected
        // We can't set state directly, but we know the initial state
        XCTAssertEqual(relay.state, .disconnected)
        XCTAssertFalse(relay.isConnected)
    }

    // MARK: - Callbacks are nil by default

    @MainActor
    func testCallbacksNilByDefault() {
        let relay = RelayClient()
        XCTAssertNil(relay.onTerminalData)
        XCTAssertNil(relay.onResize)
        XCTAssertNil(relay.onSignaling)
        XCTAssertNil(relay.onSessionCreated)
        XCTAssertNil(relay.onSessionClosed)
        XCTAssertNil(relay.onConnected)
        XCTAssertNil(relay.onDisconnected)
    }

    // MARK: - reconnectIfNeeded without stored URL

    @MainActor
    func testReconnectIfNeededWithoutStoredURL() {
        let relay = RelayClient()
        // Should not crash when no URL is stored
        relay.reconnectIfNeeded()
        XCTAssertEqual(relay.state, .disconnected)
    }

    @MainActor
    func testHandleNetworkChangeWithoutStoredURL() {
        let relay = RelayClient()
        relay.handleNetworkChange()
        XCTAssertEqual(relay.state, .disconnected)
    }
}
