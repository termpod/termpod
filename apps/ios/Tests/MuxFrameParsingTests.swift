import Foundation
import XCTest
@testable import TermPod

/// Tests for multiplexed binary frame encoding and parsing.
///
/// Frame format: [channel][sid_len][sid_bytes][payload]
/// Channels: 0x00 = terminal data (local WS), 0x01 = resize (local WS),
///           0x02 = scrollback (local WS), 0x10 = mux terminal data (WebRTC),
///           0x11 = mux terminal resize (WebRTC)
final class MuxFrameParsingTests: XCTestCase {

    // MARK: - Local WS Binary Frame Encoding

    func testEncodeLocalTerminalDataFrame() {
        let sessionId = "test-session"
        let payload = Data([0x48, 0x65, 0x6C, 0x6C, 0x6F]) // "Hello"
        let sidBytes = Array(sessionId.utf8)

        var frame = Data(capacity: 2 + sidBytes.count + payload.count)
        frame.append(0x00) // channel
        frame.append(UInt8(sidBytes.count))
        frame.append(contentsOf: sidBytes)
        frame.append(payload)

        XCTAssertEqual(frame[0], 0x00)
        XCTAssertEqual(Int(frame[1]), sidBytes.count)
        XCTAssertEqual(frame.count, 2 + sidBytes.count + payload.count)
    }

    func testEncodeLocalResizeFrame() {
        let sessionId = "sess-1"
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

    // MARK: - WebRTC Mux Frame Encoding

    func testEncodeWebRTCMuxTerminalDataFrame() {
        let sessionId = "abc-123"
        let payload = Data([0x41, 0x42]) // "AB"
        let sidBytes = Array(sessionId.utf8)

        var frame = Data(capacity: 2 + sidBytes.count + payload.count)
        frame.append(0x10) // MUX_TERMINAL_DATA
        frame.append(UInt8(sidBytes.count))
        frame.append(contentsOf: sidBytes)
        frame.append(payload)

        XCTAssertEqual(frame[0], 0x10)
        XCTAssertEqual(Int(frame[1]), 7) // "abc-123" = 7 bytes
        XCTAssertEqual(frame.count, 2 + 7 + 2)
    }

    func testEncodeWebRTCMuxResizeFrame() {
        let sessionId = "sess-2"
        let sidBytes = Array(sessionId.utf8)
        let cols = 80
        let rows = 24

        var frame = Data(capacity: 2 + sidBytes.count + 4)
        frame.append(0x11) // MUX_TERMINAL_RESIZE
        frame.append(UInt8(sidBytes.count))
        frame.append(contentsOf: sidBytes)
        frame.append(UInt8((cols >> 8) & 0xFF))
        frame.append(UInt8(cols & 0xFF))
        frame.append(UInt8((rows >> 8) & 0xFF))
        frame.append(UInt8(rows & 0xFF))

        XCTAssertEqual(frame[0], 0x11)
        let payloadStart = 2 + sidBytes.count
        let decodedCols = Int(frame[payloadStart]) << 8 | Int(frame[payloadStart + 1])
        let decodedRows = Int(frame[payloadStart + 2]) << 8 | Int(frame[payloadStart + 3])
        XCTAssertEqual(decodedCols, 80)
        XCTAssertEqual(decodedRows, 24)
    }

    // MARK: - Mux Frame Decoding (mirrors handleWebRTCMuxData / handleLocalBinaryMessage logic)

    /// Shared helper that replicates the mux parsing logic used in DeviceTransportManager.
    private func parseMuxFrame(_ data: Data) -> (channel: UInt8, sessionId: String, payloadStart: Int)? {
        guard data.count >= 2 else { return nil }

        let channel = data[0]
        let sidLen = Int(data[1])

        guard sidLen > 0, data.count >= 2 + sidLen else { return nil }

        let sidData = data[2..<(2 + sidLen)]
        guard let sessionId = String(data: sidData, encoding: .utf8) else { return nil }

        return (channel, sessionId, 2 + sidLen)
    }

    func testDecodeTerminalDataFrame() {
        let sessionId = "my-session"
        let payload = Data([0xDE, 0xAD, 0xBE, 0xEF])
        let sidBytes = Array(sessionId.utf8)

        var frame = Data()
        frame.append(0x00)
        frame.append(UInt8(sidBytes.count))
        frame.append(contentsOf: sidBytes)
        frame.append(payload)

        let result = parseMuxFrame(frame)
        XCTAssertNotNil(result)
        XCTAssertEqual(result?.channel, 0x00)
        XCTAssertEqual(result?.sessionId, "my-session")

        let decodedPayload = Data(frame[(result!.payloadStart)...])
        XCTAssertEqual(decodedPayload, payload)
    }

    func testDecodeResizeFrame() {
        let sessionId = "sess"
        let sidBytes = Array(sessionId.utf8)

        var frame = Data()
        frame.append(0x01)
        frame.append(UInt8(sidBytes.count))
        frame.append(contentsOf: sidBytes)
        // cols=132, rows=43 in big-endian
        frame.append(UInt8((132 >> 8) & 0xFF))
        frame.append(UInt8(132 & 0xFF))
        frame.append(UInt8((43 >> 8) & 0xFF))
        frame.append(UInt8(43 & 0xFF))

        let result = parseMuxFrame(frame)
        XCTAssertNotNil(result)
        XCTAssertEqual(result?.channel, 0x01)

        let ps = result!.payloadStart
        guard frame.count >= ps + 4 else {
            XCTFail("Frame too short for resize payload")
            return
        }
        let cols = Int(frame[ps]) << 8 | Int(frame[ps + 1])
        let rows = Int(frame[ps + 2]) << 8 | Int(frame[ps + 3])
        XCTAssertEqual(cols, 132)
        XCTAssertEqual(rows, 43)
    }

    func testDecodeMuxTerminalDataFrame() {
        let sessionId = "550e8400-e29b-41d4-a716-446655440000"
        let payload = Data([0xFF, 0xFE])
        let sidBytes = Array(sessionId.utf8)

        var frame = Data()
        frame.append(0x10)
        frame.append(UInt8(sidBytes.count))
        frame.append(contentsOf: sidBytes)
        frame.append(payload)

        let result = parseMuxFrame(frame)
        XCTAssertNotNil(result)
        XCTAssertEqual(result?.channel, 0x10)
        XCTAssertEqual(result?.sessionId, sessionId)

        let decodedPayload = Data(frame[(result!.payloadStart)...])
        XCTAssertEqual(decodedPayload, payload)
    }

    func testDecodeMuxResizeFrame() {
        let sessionId = "test"
        let sidBytes = Array(sessionId.utf8)

        var frame = Data()
        frame.append(0x11)
        frame.append(UInt8(sidBytes.count))
        frame.append(contentsOf: sidBytes)
        frame.append(UInt8((200 >> 8) & 0xFF))
        frame.append(UInt8(200 & 0xFF))
        frame.append(UInt8((50 >> 8) & 0xFF))
        frame.append(UInt8(50 & 0xFF))

        let result = parseMuxFrame(frame)
        XCTAssertNotNil(result)
        XCTAssertEqual(result?.channel, 0x11)

        let ps = result!.payloadStart
        let cols = Int(frame[ps]) << 8 | Int(frame[ps + 1])
        let rows = Int(frame[ps + 2]) << 8 | Int(frame[ps + 3])
        XCTAssertEqual(cols, 200)
        XCTAssertEqual(rows, 50)
    }

    // MARK: - Edge Cases

    func testFrameTooShort() {
        XCTAssertNil(parseMuxFrame(Data([0x10])))
        XCTAssertNil(parseMuxFrame(Data()))
    }

    func testZeroSidLen() {
        let frame = Data([0x10, 0x00, 0x41])
        XCTAssertNil(parseMuxFrame(frame))
    }

    func testSidLenExceedsFrameLength() {
        // sid_len=10 but only 1 byte of sid data
        let frame = Data([0x10, 0x0A, 0x41])
        XCTAssertNil(parseMuxFrame(frame))
    }

    func testEmptyPayload() {
        let sessionId = "x"
        var frame = Data()
        frame.append(0x10)
        frame.append(0x01) // sid_len = 1
        frame.append(contentsOf: Array(sessionId.utf8))
        // No payload

        let result = parseMuxFrame(frame)
        XCTAssertNotNil(result)
        XCTAssertEqual(result?.sessionId, "x")
        XCTAssertEqual(result?.payloadStart, 3)
    }

    func testResizeFrameTruncatedPayload() {
        let sessionId = "s"
        var frame = Data()
        frame.append(0x11)
        frame.append(0x01)
        frame.append(contentsOf: Array(sessionId.utf8))
        // Only 2 bytes of resize payload (needs 4)
        frame.append(0x00)
        frame.append(0x50)

        let result = parseMuxFrame(frame)
        XCTAssertNotNil(result) // parsing succeeds (channel + sid OK)
        // But resize payload check should fail
        let ps = result!.payloadStart
        XCTAssertTrue(frame.count < ps + 4, "Should have insufficient bytes for resize")
    }

    func testLongSessionId() {
        let sessionId = String(repeating: "a", count: 200)
        let sidBytes = Array(sessionId.utf8)

        var frame = Data()
        frame.append(0x10)
        frame.append(UInt8(sidBytes.count))
        frame.append(contentsOf: sidBytes)
        frame.append(0x01) // 1 byte payload

        let result = parseMuxFrame(frame)
        XCTAssertNotNil(result)
        XCTAssertEqual(result?.sessionId, sessionId)
        XCTAssertEqual(frame.count, 2 + 200 + 1)
    }

    // MARK: - Round-trip

    func testRoundTripTerminalData() {
        let sessionId = "round-trip-test"
        let payload = Data((0..<256).map { UInt8($0) })
        let sidBytes = Array(sessionId.utf8)

        // Encode
        var frame = Data()
        frame.append(0x10)
        frame.append(UInt8(sidBytes.count))
        frame.append(contentsOf: sidBytes)
        frame.append(payload)

        // Decode
        let result = parseMuxFrame(frame)
        XCTAssertNotNil(result)
        XCTAssertEqual(result?.channel, 0x10)
        XCTAssertEqual(result?.sessionId, sessionId)

        let decodedPayload = Data(frame[(result!.payloadStart)...])
        XCTAssertEqual(decodedPayload, payload)
    }

    func testRoundTripResize() {
        let sessionId = "resize-test"
        let cols = 65535
        let rows = 65535
        let sidBytes = Array(sessionId.utf8)

        // Encode
        var frame = Data()
        frame.append(0x11)
        frame.append(UInt8(sidBytes.count))
        frame.append(contentsOf: sidBytes)
        frame.append(UInt8((cols >> 8) & 0xFF))
        frame.append(UInt8(cols & 0xFF))
        frame.append(UInt8((rows >> 8) & 0xFF))
        frame.append(UInt8(rows & 0xFF))

        // Decode
        let result = parseMuxFrame(frame)
        XCTAssertNotNil(result)
        XCTAssertEqual(result?.channel, 0x11)
        XCTAssertEqual(result?.sessionId, sessionId)

        let ps = result!.payloadStart
        let decodedCols = Int(frame[ps]) << 8 | Int(frame[ps + 1])
        let decodedRows = Int(frame[ps + 2]) << 8 | Int(frame[ps + 3])
        XCTAssertEqual(decodedCols, 65535)
        XCTAssertEqual(decodedRows, 65535)
    }
}
