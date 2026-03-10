import SwiftUI

/// The main view for an active terminal session.
struct SessionDetailView: View {

    let session: Session
    let allSessions: [Session]
    let onSwitchSession: ((Session) -> Void)?

    @ObservedObject var connection: ConnectionManager
    @EnvironmentObject private var deviceTransport: DeviceTransportManager
    @EnvironmentObject private var settings: TerminalSettings
    @State private var terminalTitle: String
    @State private var showSearch = false
    @State private var showVisualBell = false

    init(session: Session, allSessions: [Session] = [], onSwitchSession: ((Session) -> Void)? = nil) {
        self.session = session
        self.allSessions = allSessions
        self.onSwitchSession = onSwitchSession
        self.connection = session.connection
        self._terminalTitle = State(initialValue: session.name)
    }

    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                // Search bar
                if showSearch {
                    SearchBarView(
                        isVisible: $showSearch,
                        terminalView: connection.terminalView
                    )
                    .transition(.move(edge: .top).combined(with: .opacity))
                }

                statusBanner
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .animation(.easeInOut(duration: 0.25), value: connection.state.isTransient)

                TerminalHostView(connection: connection)
                    .opacity(connection.state == .live ? 1 : 0)
            }

            // Connecting overlay — shown until session is live
            if connection.state != .live && connection.state != .disconnected {
                connectingOverlay
                    .transition(.opacity)
            }

            // Visual bell flash
            if showVisualBell {
                Color.white.opacity(0.15)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
                    .transition(.opacity)
            }
        }
        .navigationTitle(terminalTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                HStack(spacing: 12) {
                    Button {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                            showSearch.toggle()
                        }
                    } label: {
                        Image(systemName: "magnifyingglass")
                            .font(.system(size: 14))
                    }

                    connectionBadge
                }
            }
        }
        .gesture(sessionSwipeGesture)
        .onReceive(NotificationCenter.default.publisher(for: .terminalTitleChanged)) { notif in
            if let title = notif.userInfo?["title"] as? String {
                terminalTitle = title
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .terminalBell)) { _ in
            handleBell()
        }
        .animation(.easeInOut(duration: 0.3), value: connection.state == .live)
        .onAppear {
            UIApplication.shared.isIdleTimerDisabled = settings.keepScreenAwake
        }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = false
        }
    }

    // MARK: - Bell Handling

    private func handleBell() {
        switch settings.bellBehavior {
        case .haptic:
            HapticService.shared.playBell()
        case .sound:
            HapticService.shared.playBellSound()
        case .visual:
            withAnimation(.easeOut(duration: 0.1)) { showVisualBell = true }
            withAnimation(.easeIn(duration: 0.2).delay(0.1)) { showVisualBell = false }
        case .off:
            break
        }
    }

    // MARK: - Session Switching

    private var sessionSwipeGesture: some Gesture {
        DragGesture(minimumDistance: 80)
            .onEnded { value in
                guard let onSwitchSession, allSessions.count > 1 else { return }
                guard let currentIndex = allSessions.firstIndex(where: { $0.id == session.id }) else { return }

                let horizontal = value.translation.width
                guard abs(horizontal) > abs(value.translation.height) else { return }

                if horizontal < -80, currentIndex + 1 < allSessions.count {
                    // Swipe left -> next session
                    HapticService.shared.playTap()
                    onSwitchSession(allSessions[currentIndex + 1])
                } else if horizontal > 80, currentIndex > 0 {
                    // Swipe right -> previous session
                    HapticService.shared.playTap()
                    onSwitchSession(allSessions[currentIndex - 1])
                }
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

            HStack(spacing: 3) {
                Circle()
                    .fill(statusColor)
                    .frame(width: 5, height: 5)

                Text(sessionTransportLabel)
                    .font(.system(size: 9, weight: .semibold))
            }
            .foregroundStyle(statusColor)
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(statusColor.opacity(0.15))
            .clipShape(Capsule())
        }
    }

    private var sessionTransportLabel: String {
        let transport = connection.activeTransport
        let forced = settings.transportOverride != .auto
        let suffix = forced ? " ⚙" : ""

        if transport == .webrtc, let mode = deviceTransport.webrtcMode {
            return "P2P · \(mode.rawValue)\(suffix)"
        }

        return "\(transport.label)\(suffix)"
    }

    private var statusColor: Color {
        guard connection.state == .live else { return .orange }

        switch connection.activeTransport {
        case .local: return .green
        case .webrtc: return .blue
        case .relay: return .orange
        }
    }

    // MARK: - Connecting Overlay

    private var connectingOverlay: some View {
        VStack(spacing: 16) {
            ProgressView()
                .controlSize(.large)
                .tint(.secondary)

            Text(connectingLabel)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var connectingLabel: String {
        switch connection.state {
        case .connecting:
            return "Connecting..."
        case .connected:
            return "Connected, waiting for session..."
        case .loadingScrollback:
            return "Loading session history..."
        case .reconnecting(let attempt):
            return attempt > 5 ? "Reconnecting..." : "Reconnecting (attempt \(attempt))..."
        default:
            return "Connecting..."
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
