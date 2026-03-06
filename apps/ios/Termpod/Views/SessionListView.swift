import SwiftUI

struct SessionListView: View {

    @EnvironmentObject private var appState: AppState
    @State private var showScanner = false

    var body: some View {
        NavigationStack {
            Group {
                if appState.sessions.isEmpty {
                    ContentUnavailableView(
                        "No Sessions",
                        systemImage: "terminal",
                        description: Text("Open Termpod on your Mac and scan the QR code to connect.")
                    )
                } else {
                    List {
                        ForEach(appState.sessions) { session in
                            NavigationLink(destination: SessionDetailView(session: session)) {
                                SessionCard(session: session)
                            }
                        }
                        .onDelete { indexSet in
                            for index in indexSet {
                                appState.removeSession(appState.sessions[index])
                            }
                        }
                    }
                    .animation(.default, value: appState.sessions.count)
                }
            }
            .navigationTitle("Termpod")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showScanner = true
                    } label: {
                        Image(systemName: "qrcode.viewfinder")
                    }
                }
            }
            .sheet(isPresented: $showScanner) {
                PairingScannerView { token in
                    appState.pairWithToken(token)
                    showScanner = false
                }
            }
        }
    }
}

// MARK: - Session Card

struct SessionCard: View {

    let session: Session

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: statusIcon)
                .foregroundStyle(statusColor)
                .frame(width: 20)

            VStack(alignment: .leading, spacing: 2) {
                Text(session.name)
                    .font(.headline)

                Text(stateLabel)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()

            if session.connection.activeTransport != .relay {
                Text(session.connection.activeTransport.label)
                    .font(.caption2)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(transportColor.opacity(0.15))
                    .foregroundColor(transportColor)
                    .clipShape(Capsule())
            }
        }
        .padding(.vertical, 4)
    }

    private var statusIcon: String {
        switch session.connection.state {
        case .live: return "checkmark.circle.fill"
        case .disconnected: return "xmark.circle"
        case .reconnecting: return "arrow.trianglehead.2.clockwise.rotate.90"
        default: return "circle.dotted"
        }
    }

    private var statusColor: Color {
        switch session.connection.state {
        case .live: return .green
        case .disconnected: return .red
        case .reconnecting: return .orange
        default: return .orange
        }
    }

    private var transportColor: Color {
        switch session.connection.activeTransport {
        case .local: return .green
        case .webrtc: return .blue
        case .relay: return .orange
        }
    }

    private var stateLabel: String {
        switch session.connection.state {
        case .disconnected: return "Disconnected"
        case .connecting: return "Connecting..."
        case .connected: return "Connected"
        case .loadingScrollback: return "Loading history..."
        case .live: return "Live"
        case .reconnecting(let attempt):
            return attempt > 5 ? "Reconnecting..." : "Reconnecting (\(attempt))..."
        }
    }
}
