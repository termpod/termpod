import SwiftUI

@MainActor
final class TerminalSettings: ObservableObject {

    @AppStorage("terminal.fontSize") var fontSize: Double = 13
    @AppStorage("terminal.fontFamily") var fontFamily: FontFamily = .sfMono
    @AppStorage("terminal.themeName") var themeName: String = "defaultDark"
    @AppStorage("terminal.cursorStyle") var cursorStyle: CursorStyle = .block
    @AppStorage("terminal.cursorBlink") var cursorBlink: Bool = true
    @AppStorage("terminal.bellBehavior") var bellBehavior: BellBehavior = .haptic
    @AppStorage("terminal.keepScreenAwake") var keepScreenAwake: Bool = true
    @AppStorage("terminal.biometricLock") var biometricLockEnabled: Bool = false

    var currentTheme: TerminalTheme {
        TerminalTheme.find(themeName)
    }

    var uiFont: UIFont {
        if let font = UIFont(name: fontFamily.postScriptName, size: fontSize) {
            return font
        }
        return UIFont.monospacedSystemFont(ofSize: fontSize, weight: .regular)
    }

    /// Apply a new font size, clamped to valid range.
    func setFontSize(_ size: Double) {
        fontSize = min(max(size, 8), 24)
    }
}

// MARK: - Enums

enum FontFamily: String, CaseIterable, Identifiable {

    case sfMono = "sfMono"
    case menlo = "menlo"
    case courierNew = "courierNew"

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .sfMono: return "SF Mono"
        case .menlo: return "Menlo"
        case .courierNew: return "Courier New"
        }
    }

    var postScriptName: String {
        switch self {
        case .sfMono: return "SFMono-Regular"
        case .menlo: return "Menlo-Regular"
        case .courierNew: return "CourierNewPSMT"
        }
    }
}

enum CursorStyle: String, CaseIterable, Identifiable {

    case block
    case underline
    case bar

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .block: return "Block"
        case .underline: return "Underline"
        case .bar: return "Bar"
        }
    }

    /// ANSI escape sequence to set cursor style (DECSCUSR)
    var ansiSequence: [UInt8] {
        switch self {
        case .block: return [0x1B, 0x5B, 0x32, 0x20, 0x71]     // \e[2 q
        case .underline: return [0x1B, 0x5B, 0x34, 0x20, 0x71]  // \e[4 q
        case .bar: return [0x1B, 0x5B, 0x36, 0x20, 0x71]        // \e[6 q
        }
    }
}

enum BellBehavior: String, CaseIterable, Identifiable {

    case haptic
    case sound
    case visual
    case off

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .haptic: return "Haptic"
        case .sound: return "Sound"
        case .visual: return "Visual Flash"
        case .off: return "Off"
        }
    }

    var iconName: String {
        switch self {
        case .haptic: return "iphone.radiowaves.left.and.right"
        case .sound: return "speaker.wave.2"
        case .visual: return "lightbulb"
        case .off: return "bell.slash"
        }
    }
}
