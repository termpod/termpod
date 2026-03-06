import SwiftUI

/// The main view for an active terminal session.
struct SessionDetailView: View {

    let session: Session
    @ObservedObject var connection: ConnectionManager
    @State private var terminalTitle: String
    @State private var commandText: String = ""
    @FocusState private var isInputFocused: Bool

    init(session: Session) {
        self.session = session
        self.connection = session.connection
        self._terminalTitle = State(initialValue: session.name)
    }

    var body: some View {
        VStack(spacing: 0) {
            // Connection status banners
            statusBanner

            // Terminal output (read-only display)
            TerminalHostView(connection: connection)
        }
        .safeAreaInset(edge: .bottom) {
            commandInputBar
        }
        .navigationTitle(terminalTitle)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { isInputFocused = true }
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
        .onReceive(NotificationCenter.default.publisher(for: .terminalTapped)) { _ in
            isInputFocused = true
        }
    }

    private var commandInputBar: some View {
        VStack(spacing: 0) {
            // Special keys row
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    specialKey("Esc", bytes: [0x1B])
                    specialKey("Tab", bytes: [0x09])
                    specialKey("^C", bytes: [0x03])
                    specialKey("^D", bytes: [0x04])
                    specialKey("^Z", bytes: [0x1A])
                    specialKey("^L", bytes: [0x0C])
                    specialKey("↑", bytes: [0x1B, 0x5B, 0x41])
                    specialKey("↓", bytes: [0x1B, 0x5B, 0x42])
                    specialKey("←", bytes: [0x1B, 0x5B, 0x44])
                    specialKey("→", bytes: [0x1B, 0x5B, 0x43])
                    specialKey("|", bytes: [0x7C])
                    specialKey("~", bytes: [0x7E])
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
            }
            .background(Color(UIColor.tertiarySystemBackground))

            Divider()

            // Text input row
            HStack(spacing: 8) {
                TextField("Command...", text: $commandText)
                    .focused($isInputFocused)
                    .font(.system(.body, design: .monospaced))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .onChange(of: commandText) { oldValue, newValue in
                        sendDiff(old: oldValue, new: newValue)
                    }
                    .onSubmit {
                        sendCommand()
                    }

                Button {
                    sendCommand()
                } label: {
                    Image(systemName: "return")
                        .fontWeight(.semibold)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .background(Color(UIColor.secondarySystemBackground))
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
    }

    private func sendDiff(old: String, new: String) {
        if new.count > old.count, new.hasPrefix(old) {
            let added = String(new.dropFirst(old.count))
            if let data = added.data(using: .utf8) {
                connection.sendInput(data)
            }
        } else if new.count < old.count, old.hasPrefix(new) {
            let deleted = old.count - new.count
            connection.sendInput(Data(repeating: 0x7F, count: deleted))
        } else if new != old {
            connection.sendInput(Data(repeating: 0x7F, count: old.count))
            if let data = new.data(using: .utf8) {
                connection.sendInput(data)
            }
        }
    }

    private func sendCommand() {
        commandText = ""
        connection.sendInput(Data([0x0D]))
    }

    @ViewBuilder
    private var statusBanner: some View {
        switch connection.state {
        case .reconnecting(let attempt):
            HStack {
                ProgressView()
                    .tint(.white)
                Text("Reconnecting (attempt \(attempt))...")
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
