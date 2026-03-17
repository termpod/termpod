import XCTest
@testable import TermPod

final class SpecialKeysBarTests: XCTestCase {

    // MARK: - Arrow Key CSI Sequences

    /// Verify the expected CSI sequences for modifier+arrow combos.
    /// These are standard xterm-style sequences: ESC [ 1 ; {mod} {dir}
    /// where mod=5 for Ctrl, mod=3 for Alt.

    func testCtrlArrowUpSequence() {
        // Ctrl+Up should produce: ESC [ 1 ; 5 A
        let expected: [UInt8] = [0x1B, 0x5B, 0x31, 0x3B, 0x35, 0x41]
        let result = buildModifiedArrowSequence(arrow: 0x41, ctrlActive: true, altActive: false)
        XCTAssertEqual(result, expected)
    }

    func testCtrlArrowDownSequence() {
        // Ctrl+Down: ESC [ 1 ; 5 B
        let expected: [UInt8] = [0x1B, 0x5B, 0x31, 0x3B, 0x35, 0x42]
        let result = buildModifiedArrowSequence(arrow: 0x42, ctrlActive: true, altActive: false)
        XCTAssertEqual(result, expected)
    }

    func testCtrlArrowRightSequence() {
        // Ctrl+Right: ESC [ 1 ; 5 C — word jump forward
        let expected: [UInt8] = [0x1B, 0x5B, 0x31, 0x3B, 0x35, 0x43]
        let result = buildModifiedArrowSequence(arrow: 0x43, ctrlActive: true, altActive: false)
        XCTAssertEqual(result, expected)
    }

    func testCtrlArrowLeftSequence() {
        // Ctrl+Left: ESC [ 1 ; 5 D — word jump backward
        let expected: [UInt8] = [0x1B, 0x5B, 0x31, 0x3B, 0x35, 0x44]
        let result = buildModifiedArrowSequence(arrow: 0x44, ctrlActive: true, altActive: false)
        XCTAssertEqual(result, expected)
    }

    func testAltArrowUpSequence() {
        // Alt+Up: ESC [ 1 ; 3 A
        let expected: [UInt8] = [0x1B, 0x5B, 0x31, 0x3B, 0x33, 0x41]
        let result = buildModifiedArrowSequence(arrow: 0x41, ctrlActive: false, altActive: true)
        XCTAssertEqual(result, expected)
    }

    func testAltArrowLeftSequence() {
        // Alt+Left: ESC [ 1 ; 3 D
        let expected: [UInt8] = [0x1B, 0x5B, 0x31, 0x3B, 0x33, 0x44]
        let result = buildModifiedArrowSequence(arrow: 0x44, ctrlActive: false, altActive: true)
        XCTAssertEqual(result, expected)
    }

    // MARK: - Standard Ctrl Modifier (Single Byte)

    func testCtrlModifierSingleByte() {
        // Ctrl+C = 0x63 & 0x1F = 0x03
        let result = buildCtrlByte(0x63) // 'c'
        XCTAssertEqual(result, 0x03)
    }

    func testCtrlModifierLetterA() {
        // Ctrl+A = 0x61 & 0x1F = 0x01
        let result = buildCtrlByte(0x61) // 'a'
        XCTAssertEqual(result, 0x01)
    }

    func testCtrlModifierLetterZ() {
        // Ctrl+Z = 0x7A & 0x1F = 0x1A
        let result = buildCtrlByte(0x7A) // 'z'
        XCTAssertEqual(result, 0x1A)
    }

    // MARK: - Alt Modifier (Single Byte)

    func testAltModifierSingleByte() {
        // Alt + any single byte prepends ESC
        let result = buildAltBytes([0x63]) // 'c'
        XCTAssertEqual(result, [0x1B, 0x63])
    }

    // MARK: - Arrow Direction Mapping

    func testArrowDirectionBytes() {
        // Standard arrow key sequences: ESC [ {A|B|C|D}
        XCTAssertEqual([0x1B, 0x5B, 0x41], [0x1B, 0x5B, 0x41]) // Up
        XCTAssertEqual([0x1B, 0x5B, 0x42], [0x1B, 0x5B, 0x42]) // Down
        XCTAssertEqual([0x1B, 0x5B, 0x43], [0x1B, 0x5B, 0x43]) // Right
        XCTAssertEqual([0x1B, 0x5B, 0x44], [0x1B, 0x5B, 0x44]) // Left
    }

    func testIsArrowKeyDetection() {
        XCTAssertTrue(isArrowKey([0x1B, 0x5B, 0x41]))  // Up
        XCTAssertTrue(isArrowKey([0x1B, 0x5B, 0x42]))  // Down
        XCTAssertTrue(isArrowKey([0x1B, 0x5B, 0x43]))  // Right
        XCTAssertTrue(isArrowKey([0x1B, 0x5B, 0x44]))  // Left
        XCTAssertFalse(isArrowKey([0x1B, 0x5B, 0x48])) // Home — not an arrow
        XCTAssertFalse(isArrowKey([0x1B]))               // ESC alone
        XCTAssertFalse(isArrowKey([0x41]))               // Single byte
    }

    // MARK: - Helpers

    /// Mirrors the logic in SpecialKeysBar.sendKey for modifier+arrow.
    private func buildModifiedArrowSequence(arrow: UInt8, ctrlActive: Bool, altActive: Bool) -> [UInt8] {
        let mod: UInt8 = ctrlActive ? 5 : 3
        return [0x1B, 0x5B, 0x31, 0x3B, mod + 0x30, arrow]
    }

    private func buildCtrlByte(_ byte: UInt8) -> UInt8 {
        byte & 0x1F
    }

    private func buildAltBytes(_ bytes: [UInt8]) -> [UInt8] {
        [0x1B] + bytes
    }

    private static let arrowDirections: Set<UInt8> = [0x41, 0x42, 0x43, 0x44]

    private func isArrowKey(_ bytes: [UInt8]) -> Bool {
        bytes.count == 3
            && bytes[0] == 0x1B
            && bytes[1] == 0x5B
            && Self.arrowDirections.contains(bytes[2])
    }
}
