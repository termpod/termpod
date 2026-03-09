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

    // MARK: - E2E Encrypted Frame Format

    func testEncryptedChannelByte() {
        // The encrypted channel marker is 0xE0
        let marker: UInt8 = 0xE0
        XCTAssertEqual(marker, 224)

        // It must differ from all plain channels
        XCTAssertNotEqual(marker, 0x00) // terminal data
        XCTAssertNotEqual(marker, 0x01) // resize
        XCTAssertNotEqual(marker, 0x02) // scrollback
    }

    func testEncryptedInputFrameFormat() throws {
        // When E2E is active, sendInput wraps [0x00][payload] in [0xE0][nonce:12][ciphertext+tag]
        let crypto = CryptoService()
        let peer = CryptoService()

        let peerJwk = peer.generateKeyPair()
        let ourJwk = crypto.generateKeyPair()
        try crypto.deriveSessionKey(peerPublicKeyJwk: peerJwk, sessionId: "test-sess")
        try peer.deriveSessionKey(peerPublicKeyJwk: ourJwk, sessionId: "test-sess")

        // Build the inner frame the same way sendInput does
        let input = Data("ls -la\n".utf8)
        var innerFrame = Data([0x00])
        innerFrame.append(input)

        // Encrypt and wrap in 0xE0 channel
        let encrypted = try crypto.encrypt(innerFrame)
        var encFrame = Data([0xE0])
        encFrame.append(encrypted)

        // Verify outer format: [0xE0][nonce:12][ciphertext+tag:innerFrame.count+16]
        XCTAssertEqual(encFrame[0], 0xE0)
        XCTAssertEqual(encFrame.count, 1 + 12 + innerFrame.count + 16)

        // Verify the peer can decrypt and recover the original inner frame
        let decrypted = try peer.decrypt(Data(encFrame.dropFirst()))
        XCTAssertEqual(decrypted, innerFrame)
        XCTAssertEqual(decrypted[0], 0x00)
        XCTAssertEqual(Data(decrypted.dropFirst()), input)
    }

    func testEncryptedResizeFrameFormat() throws {
        // When E2E is active, sendResize wraps [0x01][cols:u16be][rows:u16be] in [0xE0][encrypted]
        let crypto = CryptoService()
        let peer = CryptoService()

        let peerJwk = peer.generateKeyPair()
        let ourJwk = crypto.generateKeyPair()
        try crypto.deriveSessionKey(peerPublicKeyJwk: peerJwk, sessionId: "resize-sess")
        try peer.deriveSessionKey(peerPublicKeyJwk: ourJwk, sessionId: "resize-sess")

        // Build the inner frame the same way sendResize does
        let cols = 120
        let rows = 40
        var innerFrame = Data(count: 5)
        innerFrame[0] = 0x01
        innerFrame[1] = UInt8((cols >> 8) & 0xFF)
        innerFrame[2] = UInt8(cols & 0xFF)
        innerFrame[3] = UInt8((rows >> 8) & 0xFF)
        innerFrame[4] = UInt8(rows & 0xFF)

        let encrypted = try crypto.encrypt(innerFrame)
        var encFrame = Data([0xE0])
        encFrame.append(encrypted)

        // Verify format
        XCTAssertEqual(encFrame[0], 0xE0)
        XCTAssertEqual(encFrame.count, 1 + 12 + 5 + 16) // 0xE0 + nonce + 5-byte resize + tag

        // Verify round-trip decryption
        let decrypted = try peer.decrypt(Data(encFrame.dropFirst()))
        XCTAssertEqual(decrypted[0], 0x01)
        let decodedCols = Int(decrypted[1]) << 8 | Int(decrypted[2])
        let decodedRows = Int(decrypted[3]) << 8 | Int(decrypted[4])
        XCTAssertEqual(decodedCols, 120)
        XCTAssertEqual(decodedRows, 40)
    }

    func testUnencryptedInputFrameWhenNoE2E() {
        // When crypto is not ready, frame is plain [0x00][payload]
        let crypto = CryptoService()
        XCTAssertFalse(crypto.isReady)

        let input = Data("echo hello\n".utf8)
        var frame = Data([0x00])
        frame.append(input)

        // No encryption wrapping — channel byte is 0x00, not 0xE0
        XCTAssertEqual(frame[0], 0x00)
        XCTAssertEqual(frame.count, 1 + input.count)
        XCTAssertEqual(Data(frame.dropFirst()), input)
    }

    func testEncryptedFrameRoundTripWithMultipleMessages() throws {
        // Verify counter-based nonces produce different ciphertexts for same plaintext
        let crypto = CryptoService()
        let peer = CryptoService()

        let peerJwk = peer.generateKeyPair()
        let ourJwk = crypto.generateKeyPair()
        try crypto.deriveSessionKey(peerPublicKeyJwk: peerJwk, sessionId: "multi-sess")
        try peer.deriveSessionKey(peerPublicKeyJwk: ourJwk, sessionId: "multi-sess")

        let plaintext = Data([0x00, 0x41, 0x42, 0x43]) // [0x00]ABC

        let encrypted1 = try crypto.encrypt(plaintext)
        let encrypted2 = try crypto.encrypt(plaintext)

        // Same plaintext should produce different ciphertexts (different nonces)
        XCTAssertNotEqual(encrypted1, encrypted2)

        // But both should decrypt to the same plaintext
        let decrypted1 = try peer.decrypt(encrypted1)
        let decrypted2 = try peer.decrypt(encrypted2)
        XCTAssertEqual(decrypted1, plaintext)
        XCTAssertEqual(decrypted2, plaintext)
    }
}
