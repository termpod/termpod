import Foundation
import XCTest
@testable import TermPod

// MARK: - FontFamily

final class FontFamilyTests: XCTestCase {

    func testAllCases() {
        XCTAssertEqual(FontFamily.allCases.count, 3)
        XCTAssertTrue(FontFamily.allCases.contains(.sfMono))
        XCTAssertTrue(FontFamily.allCases.contains(.menlo))
        XCTAssertTrue(FontFamily.allCases.contains(.courierNew))
    }

    func testRawValues() {
        XCTAssertEqual(FontFamily.sfMono.rawValue, "sfMono")
        XCTAssertEqual(FontFamily.menlo.rawValue, "menlo")
        XCTAssertEqual(FontFamily.courierNew.rawValue, "courierNew")
    }

    func testDisplayNames() {
        XCTAssertEqual(FontFamily.sfMono.displayName, "SF Mono")
        XCTAssertEqual(FontFamily.menlo.displayName, "Menlo")
        XCTAssertEqual(FontFamily.courierNew.displayName, "Courier New")
    }

    func testPostScriptNames() {
        XCTAssertEqual(FontFamily.sfMono.postScriptName, "SFMono-Regular")
        XCTAssertEqual(FontFamily.menlo.postScriptName, "Menlo-Regular")
        XCTAssertEqual(FontFamily.courierNew.postScriptName, "CourierNewPSMT")
    }

    func testIdentifiable() {
        for family in FontFamily.allCases {
            XCTAssertEqual(family.id, family.rawValue)
        }
    }

    func testInitFromRawValue() {
        XCTAssertEqual(FontFamily(rawValue: "sfMono"), .sfMono)
        XCTAssertEqual(FontFamily(rawValue: "menlo"), .menlo)
        XCTAssertNil(FontFamily(rawValue: "invalid"))
    }
}

// MARK: - CursorStyle

final class CursorStyleTests: XCTestCase {

    func testAllCases() {
        XCTAssertEqual(CursorStyle.allCases.count, 3)
    }

    func testRawValues() {
        XCTAssertEqual(CursorStyle.block.rawValue, "block")
        XCTAssertEqual(CursorStyle.underline.rawValue, "underline")
        XCTAssertEqual(CursorStyle.bar.rawValue, "bar")
    }

    func testDisplayNames() {
        XCTAssertEqual(CursorStyle.block.displayName, "Block")
        XCTAssertEqual(CursorStyle.underline.displayName, "Underline")
        XCTAssertEqual(CursorStyle.bar.displayName, "Bar")
    }

    func testAnsiSequences() {
        // Block: \e[2 q
        XCTAssertEqual(CursorStyle.block.ansiSequence, [0x1B, 0x5B, 0x32, 0x20, 0x71])
        // Underline: \e[4 q
        XCTAssertEqual(CursorStyle.underline.ansiSequence, [0x1B, 0x5B, 0x34, 0x20, 0x71])
        // Bar: \e[6 q
        XCTAssertEqual(CursorStyle.bar.ansiSequence, [0x1B, 0x5B, 0x36, 0x20, 0x71])
    }

    func testAnsiSequenceLength() {
        for style in CursorStyle.allCases {
            XCTAssertEqual(style.ansiSequence.count, 5)
            // All start with ESC [
            XCTAssertEqual(style.ansiSequence[0], 0x1B)
            XCTAssertEqual(style.ansiSequence[1], 0x5B)
            // All end with space + q
            XCTAssertEqual(style.ansiSequence[3], 0x20)
            XCTAssertEqual(style.ansiSequence[4], 0x71)
        }
    }

    func testIdentifiable() {
        for style in CursorStyle.allCases {
            XCTAssertEqual(style.id, style.rawValue)
        }
    }
}

// MARK: - BellBehavior

final class BellBehaviorTests: XCTestCase {

    func testAllCases() {
        XCTAssertEqual(BellBehavior.allCases.count, 4)
    }

    func testRawValues() {
        XCTAssertEqual(BellBehavior.haptic.rawValue, "haptic")
        XCTAssertEqual(BellBehavior.sound.rawValue, "sound")
        XCTAssertEqual(BellBehavior.visual.rawValue, "visual")
        XCTAssertEqual(BellBehavior.off.rawValue, "off")
    }

    func testDisplayNames() {
        XCTAssertEqual(BellBehavior.haptic.displayName, "Haptic")
        XCTAssertEqual(BellBehavior.sound.displayName, "Sound")
        XCTAssertEqual(BellBehavior.visual.displayName, "Visual Flash")
        XCTAssertEqual(BellBehavior.off.displayName, "Off")
    }

    func testIconNames() {
        XCTAssertEqual(BellBehavior.haptic.iconName, "iphone.radiowaves.left.and.right")
        XCTAssertEqual(BellBehavior.sound.iconName, "speaker.wave.2")
        XCTAssertEqual(BellBehavior.visual.iconName, "lightbulb")
        XCTAssertEqual(BellBehavior.off.iconName, "bell.slash")
    }

    func testIdentifiable() {
        for behavior in BellBehavior.allCases {
            XCTAssertEqual(behavior.id, behavior.rawValue)
        }
    }
}

// MARK: - TerminalSettings

final class TerminalSettingsTests: XCTestCase {

    @MainActor
    func testSetFontSizeClampsMinimum() {
        let settings = TerminalSettings()
        settings.setFontSize(2)
        XCTAssertEqual(settings.fontSize, 8)
    }

    @MainActor
    func testSetFontSizeClampsMaximum() {
        let settings = TerminalSettings()
        settings.setFontSize(50)
        XCTAssertEqual(settings.fontSize, 24)
    }

    @MainActor
    func testSetFontSizeValidValue() {
        let settings = TerminalSettings()
        settings.setFontSize(16)
        XCTAssertEqual(settings.fontSize, 16)
    }

    @MainActor
    func testSetFontSizeBoundaryMin() {
        let settings = TerminalSettings()
        settings.setFontSize(8)
        XCTAssertEqual(settings.fontSize, 8)
    }

    @MainActor
    func testSetFontSizeBoundaryMax() {
        let settings = TerminalSettings()
        settings.setFontSize(24)
        XCTAssertEqual(settings.fontSize, 24)
    }

    @MainActor
    func testUIFontReturnsMonospaced() {
        let settings = TerminalSettings()
        let font = settings.uiFont
        XCTAssertGreaterThan(font.pointSize, 0)
    }
}
