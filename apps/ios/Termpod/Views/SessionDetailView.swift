import SwiftUI

/// The main view for an active terminal session.
struct SessionDetailView: View {

    let session: Session
    @ObservedObject var relay: RelayClient
    @State private var terminalTitle: String

    init(session: Session) {
        self.session = session
        self.relay = session.relay
        self._terminalTitle = State(initialValue: session.name)
    }

    var body: some View {
        VStack(spacing: 0) {
            // Connection status banners
            statusBanner

            // Terminal output (SwiftTerm native view)
            // SwiftTerm provides its own TerminalAccessory (Esc, Ctrl, Tab, arrows)
            // as the keyboard inputAccessoryView — no need for a separate bar.
            TerminalHostView(relay: relay)
                .ignoresSafeArea(.keyboard)
        }
        .navigationTitle(terminalTitle)
        .navigationBarTitleDisplayMode(.inline)
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
