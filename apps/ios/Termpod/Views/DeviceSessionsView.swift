import SwiftUI

struct DeviceSessionsView: View {

    let device: DeviceService.Device

    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var auth: AuthService
    @EnvironmentObject private var deviceService: DeviceService
    @State private var sessions: [DeviceService.DeviceSession] = []
    @State private var loading = true
    @State private var joinedSession: Session?
    @State private var requestingSession = false

    var body: some View {
        Group {
            if loading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if sessions.isEmpty {
                ContentUnavailableView {
                    Label("No Sessions", systemImage: "terminal")
                } description: {
                    Text("This device has no active terminal sessions.")
                } actions: {
                    Button {
                        Task { await requestNewSession() }
                    } label: {
                        Label("New Session", systemImage: "plus")
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(requestingSession)
                }
            } else {
                List {
                    ForEach(sessions) { session in
                        Button {
                            joinSession(session)
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "terminal")
                                    .foregroundStyle(.blue)

                                VStack(alignment: .leading, spacing: 2) {
                                    Text(session.name)
                                        .font(.headline)
                                        .foregroundStyle(.primary)

                                    Text(session.cwd)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }

                                Spacer()

                                Text("\(session.ptyCols)x\(session.ptyRows)")
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                                    .monospacedDigit()
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }
            }
        }
        .animation(.default, value: sessions.count)
        .navigationTitle(device.displayName)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await requestNewSession() }
                } label: {
                    Image(systemName: "plus")
                }
                .disabled(requestingSession || !device.isOnline)
                .accessibilityLabel("New session")
                .accessibilityHint("Create a new terminal session on this device")
            }
        }
        .navigationDestination(item: $joinedSession) { session in
            SessionDetailView(session: session)
        }
        .refreshable {
            await loadSessions()
        }
        .task {
            await loadSessions()
        }
    }

    private func loadSessions() async {
        loading = true
        sessions = await deviceService.fetchSessions(auth: auth, deviceId: device.id)
        loading = false
    }

    private func requestNewSession() async {
        requestingSession = true
        HapticService.shared.playTap()

        await deviceService.requestSession(auth: auth, deviceId: device.id)

        // Wait briefly for the desktop to pick up the request and create the session
        try? await Task.sleep(for: .seconds(2))
        await loadSessions()

        requestingSession = false
    }

    private func joinSession(_ session: DeviceService.DeviceSession) {
        // If already joined, navigate to the existing session
        if let existing = appState.sessions.first(where: { $0.id == session.id }) {
            HapticService.shared.playTap()
            joinedSession = existing
            return
        }

        guard let wsURL = auth.authenticatedWSURL(sessionId: session.id) else { return }

        HapticService.shared.playTap()

        let connection = ConnectionManager(sessionId: session.id)
        let newSession = Session(
            id: session.id,
            name: session.name,
            connection: connection
        )

        appState.sessions.append(newSession)
        connection.connect(wsURL: wsURL)
        joinedSession = newSession
    }
}
