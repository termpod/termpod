import SwiftUI

/// The main view for an active terminal session.
struct SessionDetailView: View {

    let session: Session
    @ObservedObject var relay: RelayClient
    @State private var terminalTitle: String
    @State private var commandText: String = ""
    @FocusState private var isInputFocused: Bool

    init(session: Session) {
        self.session = session
        self.relay = session.relay
        self._terminalTitle = State(initialValue: session.name)
    }

    var body: some View {
        VStack(spacing: 0) {
            // Connection status banners
            statusBanner

            // Terminal output (read-only display)
            TerminalHostView(relay: relay)
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
                    if relay.connectedViewers > 0 {
                        Label("\(relay.connectedViewers)", systemImage: "eye")
                            .font(.caption)
                    }

                    Circle()
                        .fill(relay.state == .live ? Color.green : Color.orange)
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
                    .onSubmit {
                        sendCommand()
                    }

                Button {
                    sendCommand()
                } label: {
                    Image(systemName: "return")
                        .fontWeight(.semibold)
                }
                .disabled(commandText.isEmpty)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .background(Color(UIColor.secondarySystemBackground))
    }

    private func specialKey(_ label: String, bytes: [UInt8]) -> some View {
        Button {
            relay.sendInput(Data(bytes))
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

    private func sendCommand() {
        guard !commandText.isEmpty else { return }
        let text = commandText
        commandText = ""
        // Send each character followed by carriage return
        if let data = text.data(using: .utf8) {
            relay.sendInput(data)
        }
        // Send Enter (carriage return)
        relay.sendInput(Data([0x0D]))
    }

    @ViewBuilder
    private var statusBanner: some View {
        switch relay.state {
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
