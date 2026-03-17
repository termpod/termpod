import SwiftUI

struct SettingsView: View {

    @EnvironmentObject private var settings: TerminalSettings
    @ObservedObject private var clipStore = ClipStore.shared
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                appearanceSection
                behaviorSection
                transportSection
                securitySection
                clipsSection
                aboutSection
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .fontWeight(.semibold)
                }
            }
        }
    }

    // MARK: - Appearance

    private var appearanceSection: some View {
        Section {
            // Font size
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Font Size")
                    Spacer()
                    Text("\(Int(settings.fontSize))pt")
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
                Slider(value: $settings.fontSize, in: 8...24, step: 1)
                    .tint(.accentColor)
            }

            // Font family
            Picker("Font", selection: $settings.fontFamily) {
                ForEach(FontFamily.allCases) { family in
                    Text(family.displayName)
                        .tag(family)
                }
            }

            // Theme
            ThemePickerView()

            // Cursor style
            Picker("Cursor", selection: $settings.cursorStyle) {
                ForEach(CursorStyle.allCases) { style in
                    Text(style.displayName).tag(style)
                }
            }

            // Cursor blink
            Toggle("Cursor Blink", isOn: $settings.cursorBlink)
        } header: {
            Text("Appearance")
        }
    }

    // MARK: - Behavior

    private var behaviorSection: some View {
        Section {
            Picker("Bell", selection: $settings.bellBehavior) {
                ForEach(BellBehavior.allCases) { behavior in
                    Label(behavior.displayName, systemImage: behavior.iconName)
                        .tag(behavior)
                }
            }

            Toggle("Keep Screen Awake", isOn: $settings.keepScreenAwake)
        } header: {
            Text("Behavior")
        }
    }

    // MARK: - Transport

    private var transportSection: some View {
        Section {
            Picker("Transport", selection: $settings.transportOverride) {
                ForEach(TransportOverride.allCases) { override in
                    Label(override.displayName, systemImage: override.iconName)
                        .tag(override)
                }
            }
            .onChange(of: settings.transportOverride) { _, newValue in
                // Dispatch async to avoid blocking Picker animation
                DispatchQueue.main.async {
                    NotificationCenter.default.post(
                        name: .transportOverrideChanged,
                        object: nil,
                        userInfo: ["override": newValue.rawValue]
                    )
                }
            }
        } header: {
            Text("Transport")
        } footer: {
            Text(transportFooter)
        }
    }

    private var transportFooter: String {
        switch settings.transportOverride {
        case .auto:
            return "Automatically selects the best available transport."
        case .local:
            return "Force local Bonjour connection only. Requires same WiFi network."
        case .webrtc:
            return "Force WebRTC P2P connection only. Works across networks."
        case .relay:
            return "Force relay connection only. Always available but higher latency."
        }
    }

    // MARK: - Security

    @State private var pendingBiometricEnable = false

    private var securitySection: some View {
        Section {
            Toggle(biometricLabel, isOn: biometricBinding)
        } header: {
            Text("Security")
        } footer: {
            Text("Require authentication when opening the app.")
        }
    }

    private var biometricBinding: Binding<Bool> {
        Binding(
            get: { settings.biometricLockEnabled },
            set: { newValue in
                if newValue {
                    guard BiometricService.isAvailable else { return }
                    pendingBiometricEnable = true
                    Task {
                        let success = await BiometricService.authenticate()
                        pendingBiometricEnable = false
                        settings.biometricLockEnabled = success
                    }
                } else {
                    settings.biometricLockEnabled = false
                }
            }
        )
    }

    private var biometricLabel: String {
        switch BiometricService.biometryType {
        case .faceID: return "Face ID Lock"
        case .touchID: return "Touch ID Lock"
        case .opticID: return "Optic ID Lock"
        case .none: return "Biometric Lock"
        @unknown default: return "Biometric Lock"
        }
    }

    // MARK: - Clips

    private var clipsSection: some View {
        Section {
            NavigationLink {
                ClipsEditorView()
            } label: {
                HStack {
                    Label("Saved Clips", systemImage: "doc.on.clipboard")
                    Spacer()
                    Text("\(clipStore.clips.count)")
                        .foregroundStyle(.secondary)
                }
            }
        } header: {
            Text("Clips")
        } footer: {
            Text("Quick command snippets accessible from the terminal keyboard bar.")
        }
    }

    // MARK: - About

    private var aboutSection: some View {
        Section {
            HStack {
                Text("Version")
                Spacer()
                Text(appVersion)
                    .foregroundStyle(.secondary)
            }

            Link(destination: URL(string: "https://termpod.dev/privacy")!) {
                HStack {
                    Text("Privacy Policy")
                    Spacer()
                    Image(systemName: "arrow.up.forward")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Link(destination: URL(string: "https://termpod.dev")!) {
                HStack {
                    Text("Website")
                    Spacer()
                    Image(systemName: "arrow.up.forward")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        } header: {
            Text("About")
        }
    }

    private var appVersion: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(version) (\(build))"
    }
}

// MARK: - Theme Picker

private struct ThemePickerView: View {

    @EnvironmentObject private var settings: TerminalSettings
    @Environment(\.horizontalSizeClass) private var sizeClass

    private var columns: [GridItem] {
        let count = sizeClass == .regular ? 3 : 2
        return Array(repeating: GridItem(.flexible(), spacing: 12), count: count)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Theme")
                .font(.body)

            LazyVGrid(columns: columns, spacing: 10) {
                ForEach(TerminalTheme.allThemes) { theme in
                    ThemePreviewCard(
                        theme: theme,
                        isSelected: settings.themeName == theme.id
                    )
                    .onTapGesture {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                            settings.themeName = theme.id
                        }
                        HapticService.shared.playTap()
                    }
                }
            }
        }
        .listRowInsets(EdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16))
    }
}

private struct ThemePreviewCard: View {

    let theme: TerminalTheme
    let isSelected: Bool

    var body: some View {
        VStack(spacing: 0) {
            // Terminal preview
            VStack(alignment: .leading, spacing: 2) {
                previewLine("$", text: "ls -la", color: theme.ansiColors[4])
                previewLine(">", text: "node", color: theme.ansiColors[2])
                previewLine("~", text: "git status", color: theme.ansiColors[5])
            }
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(height: 56)
            .background(Color(theme.background))

            // Label
            Text(theme.name)
                .font(.caption2)
                .fontWeight(.medium)
                .foregroundStyle(isSelected ? Color.accentColor : .secondary)
                .padding(.vertical, 5)
                .frame(maxWidth: .infinity)
                .background(Color(UIColor.tertiarySystemGroupedBackground))
        }
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .strokeBorder(
                    isSelected ? Color.accentColor : Color(UIColor.separator).opacity(0.3),
                    lineWidth: isSelected ? 2 : 0.5
                )
        )
        .scaleEffect(isSelected ? 1.02 : 1.0)
    }

    private func previewLine(_ prompt: String, text: String, color: UIColor) -> some View {
        HStack(spacing: 3) {
            Text(prompt)
                .foregroundStyle(Color(theme.ansiColors[5]))
            Text(text)
                .foregroundStyle(Color(color))
        }
        .font(.system(size: 8, weight: .regular, design: .monospaced))
    }
}
