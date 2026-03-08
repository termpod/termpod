import SwiftUI

struct DeviceSessionsView: View {

    let device: DeviceService.Device

    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var auth: AuthService
    @EnvironmentObject private var deviceService: DeviceService
    @EnvironmentObject private var deviceTransport: DeviceTransportManager
    @State private var sessions: [DeviceService.DeviceSession] = []
    @State private var loading = true
    @State private var joinedSession: Session?
    @State private var requestingSession = false
    @State private var showDebugLog = false

    /// Static cache so session cards survive view recreation (NavigationStack
    /// creates a fresh view every time the user pushes back into this screen).
    private static var sessionsCache: [String: [DeviceService.DeviceSession]] = [:]

    init(device: DeviceService.Device) {
        self.device = device
        self._sessions = State(initialValue: Self.sessionsCache[device.id] ?? [])
    }

    private let columns = [
        GridItem(.flexible(), spacing: 16),
        GridItem(.flexible(), spacing: 16),
    ]

    var body: some View {
        content
        .navigationTitle(device.displayName)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                HStack(spacing: 12) {
                    transportBadge

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
        }
        .navigationDestination(item: $joinedSession) { session in
            SessionDetailView(
                session: session,
                allSessions: appState.sessions,
                onSwitchSession: { newSession in
                    joinedSession = newSession
                }
            )
        }
        .refreshable {
            await loadSessions()
        }
        .task {
            await loadSessions()
        }
        .onChange(of: sessions) { _, newValue in
            Self.sessionsCache[device.id] = newValue
        }
        .onChange(of: deviceTransport.sessions) { _, newSessions in
            handleDeviceTransportSessionsUpdate(newSessions)
        }
    }

    // MARK: - Content

    @ViewBuilder
    private var content: some View {
        if loading && sessions.isEmpty {
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
            sessionsGrid
        }
    }

    private var sessionsGrid: some View {
        ScrollView {
            LazyVGrid(columns: columns, spacing: 16) {
                ForEach(sessions) { session in
                    SessionCard(
                        session: session,
                        isActive: appState.sessions.contains { $0.id == session.id }
                    )
                    .transition(.scale.combined(with: .opacity))
                    .onTapGesture { Task { await joinSession(session) } }
                    .contextMenu {
                        Button(role: .destructive) {
                            deleteSession(session)
                        } label: {
                            Label("Close Session", systemImage: "xmark.circle")
                        }
                    }
                }
            }
            .animation(.default, value: sessions.map(\.id))
            .padding(16)
        }
    }

    // MARK: - Session Card

    private struct SessionCard: View {

        let session: DeviceService.DeviceSession
        let isActive: Bool

        var body: some View {
            VStack(alignment: .leading, spacing: 0) {
                // Terminal preview area
                ZStack(alignment: .bottomLeading) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Color(hex: "1A1B26"))
                        .frame(height: 100)

                    // Fake terminal lines
                    VStack(alignment: .leading, spacing: 3) {
                        terminalLine("$", command: shortenedCwd, color: Color(hex: "7AA2F7"))
                        if let processName = session.processName, processName != "zsh" && processName != "bash" {
                            terminalLine(">", command: processName, color: Color(hex: "9ECE6A"))
                        } else {
                            terminalLine("$", command: "█", color: Color(hex: "565F89"))
                        }
                    }
                    .padding(10)
                }
                .clipShape(UnevenRoundedRectangle(topLeadingRadius: 10, topTrailingRadius: 10))

                // Info area
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        ProcessIconView(processName: session.processName, size: 14)

                        Text(session.name)
                            .font(.subheadline)
                            .fontWeight(.medium)
                            .lineLimit(1)
                    }

                    Text(shortenedCwd)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
            }
            .background(Color(UIColor.secondarySystemGroupedBackground))
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .strokeBorder(
                        isActive ? Color.accentColor : Color(UIColor.separator).opacity(0.5),
                        lineWidth: isActive ? 2 : 0.5
                    )
            )
            .shadow(color: .black.opacity(0.08), radius: 4, y: 2)
        }

        private var shortenedCwd: String {
            let cwd = session.cwd
            guard let homeRange = cwd.range(of: "/Users/") else { return cwd }
            let afterUsers = cwd[homeRange.upperBound...]
            if let slashIndex = afterUsers.firstIndex(of: "/") {
                return "~" + String(afterUsers[slashIndex...])
            }

            return "~"
        }

        private func terminalLine(_ prompt: String, command: String, color: Color) -> some View {
            HStack(spacing: 4) {
                Text(prompt)
                    .foregroundStyle(Color(hex: "BB9AF7"))
                Text(command)
                    .foregroundStyle(color)
            }
            .font(.system(size: 10, weight: .regular, design: .monospaced))
        }
    }

    // MARK: - Device Transport Sync

    private func handleDeviceTransportSessionsUpdate(_ newSessions: [DeviceSessionInfo]) {
        guard !newSessions.isEmpty else { return }

        let updated = newSessions.map { info in
            DeviceService.DeviceSession(
                id: info.id,
                name: info.name,
                cwd: info.cwd,
                processName: info.processName,
                ptyCols: info.ptyCols,
                ptyRows: info.ptyRows
            )
        }

        let newIds = Set(updated.map(\.id))
        var merged = updated

        for session in sessions where !newIds.contains(session.id) {
            if appState.sessions.contains(where: { $0.id == session.id }) {
                merged.append(session)
            }
        }

        sessions = merged
    }

    // MARK: - Transport Badge

    private var currentTransport: TransportType {
        deviceTransport.activeTransport
    }

    private var transportBadge: some View {
        let transport = currentTransport
        let color: Color = switch transport {
        case .local: .green
        case .webrtc: .blue
        case .relay: .orange
        }

        return HStack(spacing: 4) {
            Circle()
                .fill(color)
                .frame(width: 6, height: 6)

            Text(transport.label)
                .font(.system(size: 10, weight: .semibold))
        }
        .foregroundStyle(color)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(color.opacity(0.15))
        .clipShape(Capsule())
        .onTapGesture { showDebugLog = true }
        .sheet(isPresented: $showDebugLog) {
            NavigationStack {
                List(deviceTransport.debugLog.reversed(), id: \.self) { entry in
                    Text(entry)
                        .font(.system(size: 11, design: .monospaced))
                        .listRowInsets(EdgeInsets(top: 2, leading: 8, bottom: 2, trailing: 8))
                        .textSelection(.enabled)
                }
                .navigationTitle("Transport Log")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button {
                            UIPasteboard.general.string = deviceTransport.debugLog.joined(separator: "\n")
                        } label: {
                            Label("Copy All", systemImage: "doc.on.doc")
                        }
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Done") { showDebugLog = false }
                    }
                }
            }
            .presentationDetents([.medium, .large])
        }
    }

    // MARK: - Actions

    private func deleteSession(_ session: DeviceService.DeviceSession) {
        sessions.removeAll { $0.id == session.id }

        if let joined = appState.sessions.first(where: { $0.id == session.id }) {
            appState.removeSession(joined)
        }

        deviceTransport.sendDeleteSession(sessionId: session.id)
    }

    private func loadSessions() async {
        loading = true

        // Use deviceTransport's sessions if already populated (live-updated)
        if !deviceTransport.sessions.isEmpty {
            let fetched = deviceTransport.sessions.map { info in
                DeviceService.DeviceSession(
                    id: info.id,
                    name: info.name,
                    cwd: info.cwd,
                    processName: info.processName,
                    ptyCols: info.ptyCols,
                    ptyRows: info.ptyRows
                )
            }

            mergeSessions(fetched)
            loading = false
            return
        }

        // Request via deviceTransport (handles failover: Local → WebRTC → Device WS)
        let handlerId = UUID().uuidString

        let fetched: [DeviceService.DeviceSession] = await withCheckedContinuation { (continuation: CheckedContinuation<[DeviceService.DeviceSession], Never>) in
            var resumed = false

            deviceTransport.addSessionsListHandler(id: handlerId) { sessionInfos in
                guard !resumed else { return }
                resumed = true

                let parsed = sessionInfos.map { info in
                    DeviceService.DeviceSession(
                        id: info.id,
                        name: info.name,
                        cwd: info.cwd,
                        processName: info.processName,
                        ptyCols: info.ptyCols,
                        ptyRows: info.ptyRows
                    )
                }
                continuation.resume(returning: parsed)
            }

            deviceTransport.sendListSessions()

            Task {
                try? await Task.sleep(for: .seconds(3))
                guard !resumed else { return }
                resumed = true
                deviceTransport.removeSessionsListHandler(id: handlerId)
                continuation.resume(returning: [])
            }
        }

        // Fall back to HTTP API if transport didn't return anything
        if fetched.isEmpty {
            let httpFetched = await deviceService.fetchSessions(auth: auth, deviceId: device.id)
            mergeSessions(httpFetched)
        } else {
            mergeSessions(fetched)
        }

        loading = false
    }

    private func mergeSessions(_ fetched: [DeviceService.DeviceSession]) {
        guard !fetched.isEmpty else { return }

        let fetchedIds = Set(fetched.map(\.id))
        var merged = fetched

        for session in sessions where !fetchedIds.contains(session.id) {
            if appState.sessions.contains(where: { $0.id == session.id }) {
                merged.append(session)
            }
        }

        sessions = merged
    }

    private func requestNewSession() async {
        requestingSession = true
        HapticService.shared.playTap()

        let requestId = UUID().uuidString

        // Use deviceTransport — handles failover (Local → WebRTC → Device WS)
        let result = await withCheckedContinuation { (continuation: CheckedContinuation<(String, String, String, Int, Int)?, Never>) in
            var resumed = false

            deviceTransport.addSessionCreatedHandler(id: requestId) { rId, sessionId, name, cwd, ptyCols, ptyRows in
                guard rId == requestId, !resumed else { return }
                resumed = true
                continuation.resume(returning: (sessionId, name, cwd, ptyCols, ptyRows))
            }

            deviceTransport.sendCreateSessionRequest(requestId: requestId)

            Task {
                try? await Task.sleep(for: .seconds(5))
                guard !resumed else { return }
                resumed = true
                deviceTransport.removeSessionCreatedHandler(id: requestId)
                continuation.resume(returning: nil)
            }
        }

        if let (sessionId, name, _, _, _) = result {
            guard let ws = await auth.authenticatedWSURL(sessionId: sessionId) else {
                requestingSession = false
                return
            }

            createAndJoinSession(id: sessionId, name: name, wsURL: ws.url, token: ws.token)
            requestingSession = false
            return
        }

        // Fallback: HTTP request + poll (push timed out)
        await deviceService.requestSession(auth: auth, deviceId: device.id)
        try? await Task.sleep(for: .seconds(2))
        await loadSessions()

        requestingSession = false
    }

    private func joinSession(_ session: DeviceService.DeviceSession) async {
        // If already joined, navigate to the existing session
        if let existing = appState.sessions.first(where: { $0.id == session.id }) {
            HapticService.shared.playTap()
            joinedSession = existing
            return
        }

        guard let ws = await auth.authenticatedWSURL(sessionId: session.id) else { return }

        HapticService.shared.playTap()

        createAndJoinSession(id: session.id, name: session.name, wsURL: ws.url, token: ws.token)
    }

    private func createAndJoinSession(id: String, name: String, wsURL: URL, token: String? = nil) {
        let connection = ConnectionManager(sessionId: id)
        connection.sessionName = name
        connection.deviceTransport = deviceTransport
        connection.configureLocalTransport(with: deviceTransport)
        let newSession = Session(id: id, name: name, connection: connection)

        appState.sessions.append(newSession)

        connection.onSessionClosed = {
            if let joined = appState.sessions.first(where: { $0.id == id }) {
                appState.removeSession(joined)
            }
            sessions.removeAll { $0.id == id }

            if joinedSession?.id == id {
                joinedSession = nil
            }
        }

        connection.connect(wsURL: wsURL, token: token)
        joinedSession = newSession
    }
}
