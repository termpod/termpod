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
            // Connection status banners
            statusBanner
                .transition(.move(edge: .top).combined(with: .opacity))

            // Terminal — handles keyboard input directly
            TerminalHostView(connection: connection)
        }
        .animation(.easeInOut(duration: 0.25), value: connection.state.isTransient)
        .safeAreaInset(edge: .bottom) {
            specialKeysBar
        }
        .navigationTitle(terminalTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                HStack(spacing: 12) {
                    Text(connection.activeTransport.label)
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(transportColor.opacity(0.2))
                        .foregroundColor(transportColor)
                        .clipShape(Capsule())

                    if connection.connectedViewers > 0 {
                        Label("\(connection.connectedViewers)", systemImage: "eye")
                            .font(.caption)
                    }

                    Circle()
                        .fill(connection.state == .live ? Color.green : Color.orange)
                        .frame(width: 8, height: 8)
                }
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

    // MARK: - Special Keys Bar

    private var specialKeysBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 0) {
                // Modifier keys
                Group {
                    specialKey("Esc", bytes: [0x1B])
                    specialKey("Tab", bytes: [0x09])
                    specialKey("^C", bytes: [0x03])
                    specialKey("^D", bytes: [0x04])
                    specialKey("^Z", bytes: [0x1A])
                    specialKey("^L", bytes: [0x0C])
                }

                keyDivider

                // Arrow keys
                Group {
                    specialKey("↑", bytes: [0x1B, 0x5B, 0x41])
                    specialKey("↓", bytes: [0x1B, 0x5B, 0x42])
                    specialKey("←", bytes: [0x1B, 0x5B, 0x44])
                    specialKey("→", bytes: [0x1B, 0x5B, 0x43])
                }

                keyDivider

                // Symbols
                Group {
                    specialKey("|", bytes: [0x7C])
                    specialKey("~", bytes: [0x7E])
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
        }
        .background(Color(UIColor.secondarySystemBackground))
    }

    private var keyDivider: some View {
        Rectangle()
            .fill(Color(UIColor.separator))
            .frame(width: 1, height: 20)
            .padding(.horizontal, 4)
    }

    private var transportColor: Color {
        switch connection.activeTransport {
        case .local: return .green
        case .webrtc: return .blue
        case .relay: return .orange
        }
    }

    private func specialKey(_ label: String, bytes: [UInt8]) -> some View {
        Button {
            HapticService.shared.playTap()
            connection.sendInput(Data(bytes))
        } label: {
            Text(label)
                .font(.system(size: 14, weight: .medium, design: .monospaced))
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(Color(UIColor.systemBackground))
                )
        }
        .padding(.horizontal, 2)
        .accessibilityLabel(accessibilityName(for: label))
    }

    private func accessibilityName(for key: String) -> String {
        switch key {
        case "Esc": return "Escape"
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

    @ViewBuilder
    private var statusBanner: some View {
        switch connection.state {
        case .reconnecting(let attempt):
            HStack {
                ProgressView()
                    .tint(.white)
                Text(attempt > 5
                     ? "Reconnecting..."
                     : "Reconnecting (attempt \(attempt))...")
                    .font(.caption)
                    .foregroundColor(.white)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .background(Color.orange)

        case .loadingScrollback:
            HStack {
                ProgressView()
                    .tint(.white)
                Text("Loading session history...")
                    .font(.caption)
                    .foregroundColor(.white)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .background(Color.blue)

        case .disconnected:
            HStack {
                Image(systemName: "wifi.slash")
                    .foregroundColor(.white)
                Text("Disconnected")
                    .font(.caption)
                    .foregroundColor(.white)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .background(Color.red)

        default:
            EmptyView()
        }
    }
}
