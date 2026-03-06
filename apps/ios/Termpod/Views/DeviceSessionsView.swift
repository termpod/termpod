import SwiftUI

struct DeviceSessionsView: View {

    let device: DeviceService.Device

    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var auth: AuthService
    @EnvironmentObject private var deviceService: DeviceService
    @StateObject private var localDiscovery = LocalDiscoveryService()
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
                                ProcessIconView(processName: session.processName, size: 22)

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
                    .onDelete { indexSet in
                        let toDelete = indexSet.map { sessions[$0] }

                        for session in toDelete {
                            sessions.removeAll { $0.id == session.id }

                            // Disconnect and remove from appState if joined
                            if let joined = appState.sessions.first(where: { $0.id == session.id }) {
                                joined.connection.disconnect()
                                appState.removeSession(joined)
                            }

                            Task {
                                await deviceService.deleteSession(auth: auth, sessionId: session.id)
                            }
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
            localDiscovery.start()
            // Give Bonjour a moment to discover
            try? await Task.sleep(for: .milliseconds(500))
            await loadSessions()
        }
        .onDisappear {
            localDiscovery.stop()
        }
        .onChange(of: localDiscovery.sessions) { _, newSessions in
            // React to real-time session updates from local server
            guard localDiscovery.isDiscovered else { return }

            let updated = newSessions.map { local in
                DeviceService.DeviceSession(
                    id: local.id,
                    name: local.name,
                    cwd: local.cwd,
                    processName: local.processName,
                    ptyCols: local.ptyCols,
                    ptyRows: local.ptyRows
                )
            }

            // Disconnect mobile sessions that no longer exist on desktop
            let newIds = Set(updated.map(\.id))

            for session in sessions where !newIds.contains(session.id) {
                if let joined = appState.sessions.first(where: { $0.id == session.id }) {
                    joined.connection.disconnect()
                    appState.removeSession(joined)
                }
            }

            sessions = updated
        }
    }

    private func loadSessions() async {
        loading = true

        // Try local discovery first
        if localDiscovery.isDiscovered {
            await localDiscovery.refresh()

            if !localDiscovery.sessions.isEmpty {
                sessions = localDiscovery.sessions.map { local in
                    DeviceService.DeviceSession(
                        id: local.id,
                        name: local.name,
                        cwd: local.cwd,
                        processName: local.processName,
                        ptyCols: local.ptyCols,
                        ptyRows: local.ptyRows
                    )
                }
                loading = false
                return
            }
        }

        // Fall back to relay
        sessions = await deviceService.fetchSessions(auth: auth, deviceId: device.id)
        loading = false
    }

    private func requestNewSession() async {
        requestingSession = true
        HapticService.shared.playTap()

        // Try push-based creation through an existing session's connection
        if let activeSession = appState.sessions.first(where: { $0.isConnected }) {
            let requestId = UUID().uuidString

            let result = await withCheckedContinuation { (continuation: CheckedContinuation<(String, String, String, Int, Int)?, Never>) in
                var resumed = false

                activeSession.connection.onSessionCreated = { rId, sessionId, name, cwd, ptyCols, ptyRows in
                    guard rId == requestId, !resumed else { return }
                    resumed = true
                    activeSession.connection.onSessionCreated = nil
                    continuation.resume(returning: (sessionId, name, cwd, ptyCols, ptyRows))
                }

                activeSession.connection.sendCreateSessionRequest(requestId: requestId)

                // Timeout fallback after 5 seconds
                Task {
                    try? await Task.sleep(for: .seconds(5))
                    guard !resumed else { return }
                    resumed = true
                    activeSession.connection.onSessionCreated = nil
                    continuation.resume(returning: nil)
                }
            }

            if let (sessionId, name, _, _, _) = result {
                // Session created — join it directly
                guard let wsURL = auth.authenticatedWSURL(sessionId: sessionId) else {
                    requestingSession = false
                    return
                }

                let connection = ConnectionManager(sessionId: sessionId)
                let newSession = Session(id: sessionId, name: name, connection: connection)
                appState.sessions.append(newSession)
                connection.connect(wsURL: wsURL)
                joinedSession = newSession
                requestingSession = false

                // Also refresh the session list
                await loadSessions()
                return
            }
        }

        // Fallback: HTTP request + poll (no active session or push timed out)
        await deviceService.requestSession(auth: auth, deviceId: device.id)
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
