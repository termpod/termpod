import SwiftUI

struct SpecialKeysBar: View {

    let onSendBytes: ([UInt8]) -> Void
    let onSendString: (String) -> Void

    @State private var ctrlActive = false
    @State private var altActive = false
    @State private var showClips = false

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                // Modifier toggles
                modifierGroup

                // Paste button
                pasteButton

                divider

                // Escape & Tab
                keyGroup {
                    specialKey("esc", bytes: [0x1B], wide: true)
                    specialKey("tab", bytes: [0x09], wide: true)
                }

                divider

                // Control keys
                keyGroup {
                    specialKey("^C", bytes: [0x03])
                    specialKey("^D", bytes: [0x04])
                    specialKey("^Z", bytes: [0x1A])
                    specialKey("^L", bytes: [0x0C])
                }

                divider

                // Arrow keys
                keyGroup {
                    specialKey("\u{2191}", bytes: [0x1B, 0x5B, 0x41])
                    specialKey("\u{2193}", bytes: [0x1B, 0x5B, 0x42])
                    specialKey("\u{2190}", bytes: [0x1B, 0x5B, 0x44])
                    specialKey("\u{2192}", bytes: [0x1B, 0x5B, 0x43])
                }

                divider

                // Navigation keys
                keyGroup {
                    specialKey("Home", bytes: [0x1B, 0x5B, 0x48])
                    specialKey("End", bytes: [0x1B, 0x5B, 0x46])
                    specialKey("PgUp", bytes: [0x1B, 0x5B, 0x35, 0x7E])
                    specialKey("PgDn", bytes: [0x1B, 0x5B, 0x36, 0x7E])
                }

                divider

                // Symbols
                keyGroup {
                    specialKey("|", bytes: [0x7C])
                    specialKey("~", bytes: [0x7E])
                    specialKey("-", bytes: [0x2D])
                    specialKey("_", bytes: [0x5F])
                }

                divider

                // Clips
                clipsButton
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
        }
        .background(Color(UIColor.secondarySystemBackground))
        .sheet(isPresented: $showClips) {
            ClipsPopoverView { command in
                onSendString(command)
            }
        }
    }

    // MARK: - Modifier Toggles

    private var modifierGroup: some View {
        HStack(spacing: 4) {
            modifierKey("ctrl", isActive: $ctrlActive)
            modifierKey("alt", isActive: $altActive)
        }
    }

    private func modifierKey(_ label: String, isActive: Binding<Bool>) -> some View {
        Button {
            withAnimation(.spring(response: 0.25, dampingFraction: 0.7)) {
                isActive.wrappedValue.toggle()
            }
            HapticService.shared.playTap()
        } label: {
            Text(label)
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundStyle(isActive.wrappedValue ? .white : .primary)
                .frame(minWidth: 36, minHeight: 28)
                .background(
                    RoundedRectangle(cornerRadius: 5)
                        .fill(isActive.wrappedValue ? Color.accentColor : Color(UIColor.systemBackground))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 5)
                        .strokeBorder(
                            isActive.wrappedValue
                                ? Color.accentColor
                                : Color(UIColor.separator).opacity(0.5),
                            lineWidth: 0.5
                        )
                )
        }
        .accessibilityLabel("\(label) modifier")
        .accessibilityAddTraits(isActive.wrappedValue ? .isSelected : [])
    }

    // MARK: - Keys

    private func keyGroup(@ViewBuilder content: () -> some View) -> some View {
        HStack(spacing: 4) { content() }
    }

    private var divider: some View {
        Rectangle()
            .fill(Color(UIColor.separator).opacity(0.3))
            .frame(width: 1, height: 20)
            .padding(.horizontal, 2)
    }

    private func specialKey(_ label: String, bytes: [UInt8], wide: Bool = false) -> some View {
        Button {
            sendKey(bytes)
        } label: {
            Text(label)
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .foregroundStyle(.primary)
                .frame(minWidth: wide ? 40 : 30, minHeight: 28)
                .background(
                    RoundedRectangle(cornerRadius: 5)
                        .fill(Color(UIColor.systemBackground))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 5)
                        .strokeBorder(Color(UIColor.separator).opacity(0.5), lineWidth: 0.5)
                )
        }
        .buttonStyle(TerminalKeyButtonStyle())
        .accessibilityLabel(accessibilityName(for: label))
    }

    // Arrow direction byte -> CSI direction letter
    private static let arrowDirections: [UInt8: UInt8] = [
        0x41: 0x41, // Up -> A
        0x42: 0x42, // Down -> B
        0x43: 0x43, // Right -> C
        0x44: 0x44, // Left -> D
    ]

    private func sendKey(_ bytes: [UInt8]) {
        HapticService.shared.playTap()

        var finalBytes = bytes

        // Handle modifier + arrow key: emit CSI 1;{mod}{dir}
        let isArrowKey = bytes.count == 3
            && bytes[0] == 0x1B && bytes[1] == 0x5B
            && Self.arrowDirections[bytes[2]] != nil

        if isArrowKey && (ctrlActive || altActive) {
            let mod: UInt8 = ctrlActive ? 5 : 3 // 5=Ctrl, 3=Alt
            // ESC [ 1 ; {mod} {dir}
            finalBytes = [0x1B, 0x5B, 0x31, 0x3B, mod + 0x30, bytes[2]]
            withAnimation(.spring(response: 0.25, dampingFraction: 0.7)) {
                ctrlActive = false
                altActive = false
            }
            onSendBytes(finalBytes)
            return
        }

        if altActive, bytes.count == 1 {
            // Prefix with ESC for Alt modifier
            finalBytes = [0x1B] + bytes
            withAnimation(.spring(response: 0.25, dampingFraction: 0.7)) {
                altActive = false
            }
        }

        if ctrlActive, bytes.count == 1, let byte = bytes.first {
            // Ctrl modifier: char & 0x1F
            let ctrlByte = byte & 0x1F
            finalBytes = [ctrlByte]
            withAnimation(.spring(response: 0.25, dampingFraction: 0.7)) {
                ctrlActive = false
            }
        }

        onSendBytes(finalBytes)
    }

    // MARK: - Paste Button

    private var pasteButton: some View {
        Button {
            HapticService.shared.playTap()
            if let text = UIPasteboard.general.string {
                onSendString(text)
            }
        } label: {
            Image(systemName: "doc.on.clipboard.fill")
                .font(.system(size: 12))
                .foregroundStyle(.primary)
                .frame(minWidth: 30, minHeight: 28)
                .background(
                    RoundedRectangle(cornerRadius: 5)
                        .fill(Color(UIColor.systemBackground))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 5)
                        .strokeBorder(Color(UIColor.separator).opacity(0.5), lineWidth: 0.5)
                )
        }
        .buttonStyle(TerminalKeyButtonStyle())
        .accessibilityLabel("Paste from clipboard")
    }

    // MARK: - Clips Button

    private var clipsButton: some View {
        Button {
            showClips = true
            HapticService.shared.playTap()
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "doc.on.clipboard")
                    .font(.system(size: 10))
                Text("Clips")
                    .font(.system(size: 11, weight: .medium))
            }
            .foregroundStyle(Color.accentColor)
            .frame(minHeight: 28)
            .padding(.horizontal, 10)
            .background(
                RoundedRectangle(cornerRadius: 5)
                    .fill(Color.accentColor.opacity(0.1))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 5)
                    .strokeBorder(Color.accentColor.opacity(0.3), lineWidth: 0.5)
            )
        }
    }

    private func accessibilityName(for key: String) -> String {
        switch key {
        case "esc": return "Escape"
        case "tab": return "Tab"
        case "^C": return "Control C"
        case "^D": return "Control D"
        case "^Z": return "Control Z"
        case "^L": return "Control L"
        case "\u{2191}": return "Arrow up"
        case "\u{2193}": return "Arrow down"
        case "\u{2190}": return "Arrow left"
        case "\u{2192}": return "Arrow right"
        case "|": return "Pipe"
        case "~": return "Tilde"
        case "Home": return "Home"
        case "End": return "End"
        case "PgUp": return "Page up"
        case "PgDn": return "Page down"
        default: return key
        }
    }
}

// MARK: - Button Style

struct TerminalKeyButtonStyle: ButtonStyle {

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.92 : 1.0)
            .opacity(configuration.isPressed ? 0.7 : 1.0)
            .animation(.spring(response: 0.2, dampingFraction: 0.6), value: configuration.isPressed)
    }
}

// MARK: - Clips Popover

struct ClipsPopoverView: View {

    let onSelect: (String) -> Void
    @ObservedObject private var store = ClipStore.shared
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if store.clips.isEmpty {
                    ContentUnavailableView {
                        Label("No Clips", systemImage: "doc.on.clipboard")
                    } description: {
                        Text("Add clips in Settings to use them here.")
                    }
                } else {
                    List(store.clips) { clip in
                        Button {
                            onSelect(clip.command)
                            dismiss()
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(clip.name)
                                    .font(.subheadline)
                                    .fontWeight(.medium)
                                    .foregroundStyle(.primary)

                                Text(clip.command)
                                    .font(.caption)
                                    .fontDesign(.monospaced)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }
                            .padding(.vertical, 2)
                        }
                    }
                }
            }
            .navigationTitle("Clips")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium])
    }
}
