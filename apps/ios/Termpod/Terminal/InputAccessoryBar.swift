import SwiftUI

/// Toolbar shown above the keyboard with terminal-specific keys.
struct InputAccessoryBar: View {

    let onKey: (Data) -> Void

    @State private var ctrlActive = false

    private struct KeyDef: Identifiable {
        let id: String
        let label: String
        let data: Data
        let isModifier: Bool

        init(_ label: String, _ bytes: [UInt8], isModifier: Bool = false) {
            self.id = label
            self.label = label
            self.data = Data(bytes)
            self.isModifier = isModifier
        }

        init(_ label: String, _ string: String, isModifier: Bool = false) {
            self.id = label
            self.label = label
            self.data = Data(string.utf8)
            self.isModifier = isModifier
        }
    }

    private let keys: [KeyDef] = [
        KeyDef("Esc", [0x1b]),
        KeyDef("Ctrl", [], isModifier: true),
        KeyDef("Tab", [0x09]),
        KeyDef("Up", [0x1b, 0x5b, 0x41]),      // \e[A
        KeyDef("Down", [0x1b, 0x5b, 0x42]),     // \e[B
        KeyDef("Left", [0x1b, 0x5b, 0x44]),     // \e[D (correct)
        KeyDef("Right", [0x1b, 0x5b, 0x43]),    // \e[C (correct)
        KeyDef("|", "|"),
        KeyDef("/", "/"),
        KeyDef("-", "-"),
        KeyDef("~", "~"),
    ]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(keys) { key in
                    Button {
                        handleTap(key)
                    } label: {
                        Text(key.label)
                            .font(.system(size: 14, weight: .medium, design: .monospaced))
                            .foregroundColor(
                                key.isModifier && ctrlActive
                                    ? Color.black
                                    : Color(.systemGray)
                            )
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(
                                key.isModifier && ctrlActive
                                    ? Color.cyan
                                    : Color(.systemGray6)
                            )
                            .cornerRadius(6)
                    }
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
        }
        .background(Color(.systemGroupedBackground))
    }

    private func handleTap(_ key: KeyDef) {
        if key.isModifier {
            ctrlActive.toggle()
            return
        }

        if ctrlActive {
            // Convert to ctrl character: Ctrl+A = 0x01, Ctrl+C = 0x03, etc.
            if let char = key.label.lowercased().first,
               char.isLetter,
               let ascii = char.asciiValue {
                let ctrlByte = ascii - 0x60 // 'a' = 0x61, Ctrl+A = 0x01
                onKey(Data([ctrlByte]))
            } else {
                onKey(key.data)
            }
            ctrlActive = false
        } else {
            onKey(key.data)
        }
    }
}
