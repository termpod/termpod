import UIKit

struct TerminalTheme: Identifiable, Equatable {

    let id: String
    let name: String
    let foreground: UIColor
    let background: UIColor
    let cursor: UIColor
    let selection: UIColor
    let ansiColors: [UIColor] // 16 colors: normal 0-7, bright 8-15

    static let allThemes: [TerminalTheme] = [
        .defaultDark, .dracula, .nord, .monokai,
        .solarizedDark, .solarizedLight, .tokyoNight,
        .catppuccinMocha, .oneDark, .gruvboxDark,
    ]

    private static let themeLookup: [String: TerminalTheme] = {
        Dictionary(uniqueKeysWithValues: allThemes.map { ($0.id, $0) })
    }()

    static func find(_ id: String) -> TerminalTheme {
        themeLookup[id] ?? .defaultDark
    }
}

// MARK: - Built-in Themes

extension TerminalTheme {

    static let defaultDark = TerminalTheme(
        id: "defaultDark",
        name: "Default Dark",
        foreground: UIColor(hex: "CDCBF0"),
        background: UIColor(hex: "161820"),
        cursor: UIColor(hex: "CDCBF0"),
        selection: UIColor(hex: "3E4058"),
        ansiColors: [
            UIColor(hex: "282A36"), UIColor(hex: "FF5555"), UIColor(hex: "50FA7B"), UIColor(hex: "F1FA8C"),
            UIColor(hex: "BD93F9"), UIColor(hex: "FF79C6"), UIColor(hex: "8BE9FD"), UIColor(hex: "F8F8F2"),
            UIColor(hex: "6272A4"), UIColor(hex: "FF6E6E"), UIColor(hex: "69FF94"), UIColor(hex: "FFFFA5"),
            UIColor(hex: "D6ACFF"), UIColor(hex: "FF92DF"), UIColor(hex: "A4FFFF"), UIColor(hex: "FFFFFF"),
        ]
    )

    static let dracula = TerminalTheme(
        id: "dracula",
        name: "Dracula",
        foreground: UIColor(hex: "F8F8F2"),
        background: UIColor(hex: "282A36"),
        cursor: UIColor(hex: "F8F8F2"),
        selection: UIColor(hex: "44475A"),
        ansiColors: [
            UIColor(hex: "21222C"), UIColor(hex: "FF5555"), UIColor(hex: "50FA7B"), UIColor(hex: "F1FA8C"),
            UIColor(hex: "BD93F9"), UIColor(hex: "FF79C6"), UIColor(hex: "8BE9FD"), UIColor(hex: "F8F8F2"),
            UIColor(hex: "6272A4"), UIColor(hex: "FF6E6E"), UIColor(hex: "69FF94"), UIColor(hex: "FFFFA5"),
            UIColor(hex: "D6ACFF"), UIColor(hex: "FF92DF"), UIColor(hex: "A4FFFF"), UIColor(hex: "FFFFFF"),
        ]
    )

    static let nord = TerminalTheme(
        id: "nord",
        name: "Nord",
        foreground: UIColor(hex: "D8DEE9"),
        background: UIColor(hex: "2E3440"),
        cursor: UIColor(hex: "D8DEE9"),
        selection: UIColor(hex: "434C5E"),
        ansiColors: [
            UIColor(hex: "3B4252"), UIColor(hex: "BF616A"), UIColor(hex: "A3BE8C"), UIColor(hex: "EBCB8B"),
            UIColor(hex: "81A1C1"), UIColor(hex: "B48EAD"), UIColor(hex: "88C0D0"), UIColor(hex: "E5E9F0"),
            UIColor(hex: "4C566A"), UIColor(hex: "BF616A"), UIColor(hex: "A3BE8C"), UIColor(hex: "EBCB8B"),
            UIColor(hex: "81A1C1"), UIColor(hex: "B48EAD"), UIColor(hex: "8FBCBB"), UIColor(hex: "ECEFF4"),
        ]
    )

    static let monokai = TerminalTheme(
        id: "monokai",
        name: "Monokai",
        foreground: UIColor(hex: "F8F8F2"),
        background: UIColor(hex: "272822"),
        cursor: UIColor(hex: "F8F8F0"),
        selection: UIColor(hex: "49483E"),
        ansiColors: [
            UIColor(hex: "272822"), UIColor(hex: "F92672"), UIColor(hex: "A6E22E"), UIColor(hex: "F4BF75"),
            UIColor(hex: "66D9EF"), UIColor(hex: "AE81FF"), UIColor(hex: "A1EFE4"), UIColor(hex: "F8F8F2"),
            UIColor(hex: "75715E"), UIColor(hex: "F92672"), UIColor(hex: "A6E22E"), UIColor(hex: "F4BF75"),
            UIColor(hex: "66D9EF"), UIColor(hex: "AE81FF"), UIColor(hex: "A1EFE4"), UIColor(hex: "F9F8F5"),
        ]
    )

    static let solarizedDark = TerminalTheme(
        id: "solarizedDark",
        name: "Solarized Dark",
        foreground: UIColor(hex: "839496"),
        background: UIColor(hex: "002B36"),
        cursor: UIColor(hex: "839496"),
        selection: UIColor(hex: "073642"),
        ansiColors: [
            UIColor(hex: "073642"), UIColor(hex: "DC322F"), UIColor(hex: "859900"), UIColor(hex: "B58900"),
            UIColor(hex: "268BD2"), UIColor(hex: "D33682"), UIColor(hex: "2AA198"), UIColor(hex: "EEE8D5"),
            UIColor(hex: "002B36"), UIColor(hex: "CB4B16"), UIColor(hex: "586E75"), UIColor(hex: "657B83"),
            UIColor(hex: "839496"), UIColor(hex: "6C71C4"), UIColor(hex: "93A1A1"), UIColor(hex: "FDF6E3"),
        ]
    )

    static let solarizedLight = TerminalTheme(
        id: "solarizedLight",
        name: "Solarized Light",
        foreground: UIColor(hex: "657B83"),
        background: UIColor(hex: "FDF6E3"),
        cursor: UIColor(hex: "657B83"),
        selection: UIColor(hex: "EEE8D5"),
        ansiColors: [
            UIColor(hex: "073642"), UIColor(hex: "DC322F"), UIColor(hex: "859900"), UIColor(hex: "B58900"),
            UIColor(hex: "268BD2"), UIColor(hex: "D33682"), UIColor(hex: "2AA198"), UIColor(hex: "EEE8D5"),
            UIColor(hex: "002B36"), UIColor(hex: "CB4B16"), UIColor(hex: "586E75"), UIColor(hex: "657B83"),
            UIColor(hex: "839496"), UIColor(hex: "6C71C4"), UIColor(hex: "93A1A1"), UIColor(hex: "FDF6E3"),
        ]
    )

    static let tokyoNight = TerminalTheme(
        id: "tokyoNight",
        name: "Tokyo Night",
        foreground: UIColor(hex: "A9B1D6"),
        background: UIColor(hex: "1A1B26"),
        cursor: UIColor(hex: "C0CAF5"),
        selection: UIColor(hex: "33467C"),
        ansiColors: [
            UIColor(hex: "15161E"), UIColor(hex: "F7768E"), UIColor(hex: "9ECE6A"), UIColor(hex: "E0AF68"),
            UIColor(hex: "7AA2F7"), UIColor(hex: "BB9AF7"), UIColor(hex: "7DCFFF"), UIColor(hex: "A9B1D6"),
            UIColor(hex: "414868"), UIColor(hex: "F7768E"), UIColor(hex: "9ECE6A"), UIColor(hex: "E0AF68"),
            UIColor(hex: "7AA2F7"), UIColor(hex: "BB9AF7"), UIColor(hex: "7DCFFF"), UIColor(hex: "C0CAF5"),
        ]
    )

    static let catppuccinMocha = TerminalTheme(
        id: "catppuccinMocha",
        name: "Catppuccin Mocha",
        foreground: UIColor(hex: "CDD6F4"),
        background: UIColor(hex: "1E1E2E"),
        cursor: UIColor(hex: "F5E0DC"),
        selection: UIColor(hex: "45475A"),
        ansiColors: [
            UIColor(hex: "45475A"), UIColor(hex: "F38BA8"), UIColor(hex: "A6E3A1"), UIColor(hex: "F9E2AF"),
            UIColor(hex: "89B4FA"), UIColor(hex: "F5C2E7"), UIColor(hex: "94E2D5"), UIColor(hex: "BAC2DE"),
            UIColor(hex: "585B70"), UIColor(hex: "F38BA8"), UIColor(hex: "A6E3A1"), UIColor(hex: "F9E2AF"),
            UIColor(hex: "89B4FA"), UIColor(hex: "F5C2E7"), UIColor(hex: "94E2D5"), UIColor(hex: "A6ADC8"),
        ]
    )

    static let oneDark = TerminalTheme(
        id: "oneDark",
        name: "One Dark",
        foreground: UIColor(hex: "ABB2BF"),
        background: UIColor(hex: "282C34"),
        cursor: UIColor(hex: "528BFF"),
        selection: UIColor(hex: "3E4451"),
        ansiColors: [
            UIColor(hex: "282C34"), UIColor(hex: "E06C75"), UIColor(hex: "98C379"), UIColor(hex: "E5C07B"),
            UIColor(hex: "61AFEF"), UIColor(hex: "C678DD"), UIColor(hex: "56B6C2"), UIColor(hex: "ABB2BF"),
            UIColor(hex: "545862"), UIColor(hex: "E06C75"), UIColor(hex: "98C379"), UIColor(hex: "E5C07B"),
            UIColor(hex: "61AFEF"), UIColor(hex: "C678DD"), UIColor(hex: "56B6C2"), UIColor(hex: "C8CCD4"),
        ]
    )

    static let gruvboxDark = TerminalTheme(
        id: "gruvboxDark",
        name: "Gruvbox Dark",
        foreground: UIColor(hex: "EBDBB2"),
        background: UIColor(hex: "282828"),
        cursor: UIColor(hex: "EBDBB2"),
        selection: UIColor(hex: "3C3836"),
        ansiColors: [
            UIColor(hex: "282828"), UIColor(hex: "CC241D"), UIColor(hex: "98971A"), UIColor(hex: "D79921"),
            UIColor(hex: "458588"), UIColor(hex: "B16286"), UIColor(hex: "689D6A"), UIColor(hex: "A89984"),
            UIColor(hex: "928374"), UIColor(hex: "FB4934"), UIColor(hex: "B8BB26"), UIColor(hex: "FABD2F"),
            UIColor(hex: "83A598"), UIColor(hex: "D3869B"), UIColor(hex: "8EC07C"), UIColor(hex: "EBDBB2"),
        ]
    )
}

// MARK: - SwiftTerm Color Conversion

import SwiftTerm

extension UIColor {

    func toSwiftTermColor() -> SwiftTerm.Color {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        getRed(&r, green: &g, blue: &b, alpha: &a)
        return SwiftTerm.Color(
            red: UInt16(r * 65535),
            green: UInt16(g * 65535),
            blue: UInt16(b * 65535)
        )
    }
}

// MARK: - UIColor Hex Init

extension UIColor {

    convenience init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)

        let r, g, b: UInt64
        switch hex.count {
        case 6:
            (r, g, b) = ((int >> 16) & 0xFF, (int >> 8) & 0xFF, int & 0xFF)
        default:
            (r, g, b) = (0, 0, 0)
        }

        self.init(
            red: CGFloat(r) / 255,
            green: CGFloat(g) / 255,
            blue: CGFloat(b) / 255,
            alpha: 1
        )
    }
}
