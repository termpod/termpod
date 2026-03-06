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
            Circle()
                .fill(session.isConnected ? Color.green : Color.orange)
                .frame(width: 10, height: 10)

            VStack(alignment: .leading, spacing: 2) {
                Text(session.name)
                    .font(.headline)

                Text(stateLabel)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()
        }
        .padding(.vertical, 4)
    }

    private var stateLabel: String {
        let transport = session.connection.activeTransport
        let prefix = transport != .relay ? "[\(transport.label)] " : ""

        switch session.connection.state {
        case .disconnected: return "Disconnected"
        case .connecting: return "Connecting..."
        case .connected: return "Connected"
        case .loadingScrollback: return "Loading history..."
        case .live: return "\(prefix)Live"
        case .reconnecting(let attempt): return "Reconnecting (\(attempt))..."
        }
    }
}
