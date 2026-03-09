import UIKit
import XCTest
@testable import TermPod

final class TerminalThemeTests: XCTestCase {

    // MARK: - Theme Registry

    func testAllThemesCount() {
        XCTAssertEqual(TerminalTheme.allThemes.count, 10)
    }

    func testAllThemesHaveUniqueIds() {
        let ids = TerminalTheme.allThemes.map(\.id)
        XCTAssertEqual(Set(ids).count, ids.count, "Theme IDs should be unique")
    }

    func testAllThemesHaveNonEmptyNames() {
        for theme in TerminalTheme.allThemes {
            XCTAssertFalse(theme.name.isEmpty, "Theme \(theme.id) has empty name")
        }
    }

    func testAllThemesHave16AnsiColors() {
        for theme in TerminalTheme.allThemes {
            XCTAssertEqual(theme.ansiColors.count, 16, "Theme \(theme.id) should have 16 ANSI colors")
        }
    }

    // MARK: - Theme Lookup

    func testFindExistingTheme() {
        let theme = TerminalTheme.find("dracula")
        XCTAssertEqual(theme.id, "dracula")
        XCTAssertEqual(theme.name, "Dracula")
    }

    func testFindDefaultDark() {
        let theme = TerminalTheme.find("defaultDark")
        XCTAssertEqual(theme.id, "defaultDark")
        XCTAssertEqual(theme.name, "Default Dark")
    }

    func testFindUnknownThemeFallsBackToDefaultDark() {
        let theme = TerminalTheme.find("nonexistent")
        XCTAssertEqual(theme.id, "defaultDark")
    }

    func testFindEmptyStringFallsBackToDefaultDark() {
        let theme = TerminalTheme.find("")
        XCTAssertEqual(theme.id, "defaultDark")
    }

    func testFindAllThemesById() {
        let expectedIds = [
            "defaultDark", "dracula", "nord", "monokai",
            "solarizedDark", "solarizedLight", "tokyoNight",
            "catppuccinMocha", "oneDark", "gruvboxDark",
        ]

        for id in expectedIds {
            let theme = TerminalTheme.find(id)
            XCTAssertEqual(theme.id, id, "Should find theme with id '\(id)'")
        }
    }

    // MARK: - Theme Equatable

    func testThemeEquatable() {
        let theme1 = TerminalTheme.find("nord")
        let theme2 = TerminalTheme.find("nord")
        XCTAssertEqual(theme1, theme2)
    }

    func testThemeNotEqual() {
        let theme1 = TerminalTheme.find("nord")
        let theme2 = TerminalTheme.find("dracula")
        XCTAssertNotEqual(theme1, theme2)
    }

    // MARK: - UIColor Hex Init

    func testHexBlack() {
        let color = UIColor(hex: "000000")
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        color.getRed(&r, green: &g, blue: &b, alpha: &a)
        XCTAssertEqual(r, 0, accuracy: 0.01)
        XCTAssertEqual(g, 0, accuracy: 0.01)
        XCTAssertEqual(b, 0, accuracy: 0.01)
        XCTAssertEqual(a, 1, accuracy: 0.01)
    }

    func testHexWhite() {
        let color = UIColor(hex: "FFFFFF")
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        color.getRed(&r, green: &g, blue: &b, alpha: &a)
        XCTAssertEqual(r, 1, accuracy: 0.01)
        XCTAssertEqual(g, 1, accuracy: 0.01)
        XCTAssertEqual(b, 1, accuracy: 0.01)
    }

    func testHexRed() {
        let color = UIColor(hex: "FF0000")
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        color.getRed(&r, green: &g, blue: &b, alpha: &a)
        XCTAssertEqual(r, 1, accuracy: 0.01)
        XCTAssertEqual(g, 0, accuracy: 0.01)
        XCTAssertEqual(b, 0, accuracy: 0.01)
    }

    func testHexWithHashPrefix() {
        let color = UIColor(hex: "#FF5555")
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        color.getRed(&r, green: &g, blue: &b, alpha: &a)
        XCTAssertEqual(r, 1.0, accuracy: 0.01)
        XCTAssertEqual(g, 85.0 / 255.0, accuracy: 0.01)
        XCTAssertEqual(b, 85.0 / 255.0, accuracy: 0.01)
    }

    func testHexLowercase() {
        let color = UIColor(hex: "ff5555")
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        color.getRed(&r, green: &g, blue: &b, alpha: &a)
        XCTAssertEqual(r, 1.0, accuracy: 0.01)
        XCTAssertEqual(g, 85.0 / 255.0, accuracy: 0.01)
    }

    func testHexSpecificColor() {
        // Dracula background: 282A36
        let color = UIColor(hex: "282A36")
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        color.getRed(&r, green: &g, blue: &b, alpha: &a)
        XCTAssertEqual(r, 40.0 / 255.0, accuracy: 0.01)
        XCTAssertEqual(g, 42.0 / 255.0, accuracy: 0.01)
        XCTAssertEqual(b, 54.0 / 255.0, accuracy: 0.01)
    }

    // MARK: - SwiftTerm Color Conversion

    func testToSwiftTermColorWhite() {
        let white = UIColor(hex: "FFFFFF")
        let stColor = white.toSwiftTermColor()
        XCTAssertEqual(stColor.red, 65535)
        XCTAssertEqual(stColor.green, 65535)
        XCTAssertEqual(stColor.blue, 65535)
    }

    func testToSwiftTermColorBlack() {
        let black = UIColor(hex: "000000")
        let stColor = black.toSwiftTermColor()
        XCTAssertEqual(stColor.red, 0)
        XCTAssertEqual(stColor.green, 0)
        XCTAssertEqual(stColor.blue, 0)
    }
}
