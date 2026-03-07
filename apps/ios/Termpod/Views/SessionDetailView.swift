import SwiftUI

/// The main view for an active terminal session.
struct SessionDetailView: View {

    let session: Session
    @ObservedObject var connection: ConnectionManager
    @State private var terminalTitle: String

    init(session: Session) {
        self.session = session
        self.connection = session.connection
        self._terminalTitle = State(initialValue: session.name)
    }

    var body: some View {
        VStack(spacing: 0) {
            statusBanner
                .transition(.move(edge: .top).combined(with: .opacity))
                .animation(.easeInOut(duration: 0.25), value: connection.state.isTransient)

            TerminalHostView(connection: connection)
        }
        .safeAreaInset(edge: .bottom) {
            specialKeysBar
        }
        .navigationTitle(terminalTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                connectionBadge
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .terminalTitleChanged)) { notif in
            if let title = notif.userInfo?["title"] as? String {
                terminalTitle = title
            }
        }
        .onAppear {
            UIApplication.shared.isIdleTimerDisabled = true
        }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
        }
    }

    // MARK: - Connection Badge

    private var connectionBadge: some View {
        HStack(spacing: 6) {
            if connection.connectedViewers > 0 {
                HStack(spacing: 3) {
                    Image(systemName: "eye")
                        .font(.system(size: 9))
                    Text("\(connection.connectedViewers)")
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                }
                .foregroundStyle(.white.opacity(0.5))
                .padding(.trailing, 4)
            }

            HStack(spacing: 4) {
                Circle()
                    .fill(statusColor)
                    .frame(width: 6, height: 6)

                Text(connection.activeTransport.label)
                    .font(.system(size: 10, weight: .semibold))
            }
            .foregroundStyle(statusColor)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(statusColor.opacity(0.15))
            .clipShape(Capsule())
        }
    }

    private var statusColor: Color {
        guard connection.state == .live else { return .orange }

        switch connection.activeTransport {
        case .local: return .green
        case .webrtc: return .blue
        case .relay: return .orange
        }
    }

    // MARK: - Special Keys Bar

    private var specialKeysBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                keyGroup {
                    specialKey("esc", bytes: [0x1B], wide: true)
                    specialKey("tab", bytes: [0x09], wide: true)
                }

                keyGroup {
                    specialKey("^C", bytes: [0x03])
                    specialKey("^D", bytes: [0x04])
                    specialKey("^Z", bytes: [0x1A])
                    specialKey("^L", bytes: [0x0C])
                }

                keyGroup {
                    specialKey("↑", bytes: [0x1B, 0x5B, 0x41])
                    specialKey("↓", bytes: [0x1B, 0x5B, 0x42])
                    specialKey("←", bytes: [0x1B, 0x5B, 0x44])
                    specialKey("→", bytes: [0x1B, 0x5B, 0x43])
                }

                keyGroup {
                    specialKey("|", bytes: [0x7C])
                    specialKey("~", bytes: [0x7E])
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
        }
        .background(Color(UIColor.secondarySystemBackground))
    }

    private func keyGroup(@ViewBuilder content: () -> some View) -> some View {
        HStack(spacing: 4) {
            content()
        }
    }

    private func specialKey(_ label: String, bytes: [UInt8], wide: Bool = false) -> some View {
        Button {
            HapticService.shared.playTap()
            connection.sendInput(Data(bytes))
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
        .accessibilityLabel(accessibilityName(for: label))
    }

    private func accessibilityName(for key: String) -> String {
        switch key {
        case "esc": return "Escape"
        case "tab": return "Tab"
        case "^C": return "Control C"
        case "^D": return "Control D"
        case "^Z": return "Control Z"
        case "^L": return "Control L"
        case "↑": return "Arrow up"
        case "↓": return "Arrow down"
        case "←": return "Arrow left"
        case "→": return "Arrow right"
        case "|": return "Pipe"
        case "~": return "Tilde"
        default: return key
        }
    }

    // MARK: - Status Banner

    @ViewBuilder
    private var statusBanner: some View {
        switch connection.state {
        case .reconnecting(let attempt):
            bannerView(
                icon: nil,
                text: attempt > 5
                    ? "Reconnecting..."
                    : "Reconnecting (attempt \(attempt))...",
                color: .orange,
                showSpinner: true
            )

        case .loadingScrollback:
            bannerView(
                icon: nil,
                text: "Loading session history...",
                color: .blue,
                showSpinner: true
            )

        case .disconnected:
            bannerView(
                icon: "bolt.slash.fill",
                text: "Disconnected",
                color: .red,
                showSpinner: false
            )

        default:
            EmptyView()
        }
    }

    private func bannerView(icon: String?, text: String, color: Color, showSpinner: Bool) -> some View {
        HStack(spacing: 6) {
            if showSpinner {
                ProgressView()
                    .tint(color)
                    .scaleEffect(0.7)
            } else if let icon {
                Image(systemName: icon)
                    .font(.caption2)
                    .foregroundStyle(color)
            }

            Text(text)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(color)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 5)
        .background(color.opacity(0.12))
    }
}
