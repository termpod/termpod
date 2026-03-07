import SwiftUI
import Network

struct DeviceListView: View {

    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var auth: AuthService
    @EnvironmentObject private var deviceService: DeviceService
    @State private var localDesktopFound = false
    @State private var bonjourBrowser: NWBrowser?
    @State private var showSettings = false

    var body: some View {
        NavigationStack {
            List {
                // Registered devices
                Section {
                    if deviceService.loading && deviceService.devices.isEmpty {
                        HStack {
                            Spacer()
                            ProgressView()
                            Spacer()
                        }
                    } else if deviceService.devices.isEmpty {
                        ContentUnavailableView {
                            Label("No Devices", systemImage: "desktopcomputer")
                        } description: {
                            Text("Open TermPod on your Mac to register a device.")
                        }
                        .listRowBackground(Color.clear)
                    } else {
                        ForEach(devicesWithLocalStatus) { device in
                            NavigationLink(value: device.id) {
                                DeviceRow(
                                    device: device,
                                    transport: transportForDevice(device)
                                )
                            }
                        }
                    }
                } header: {
                    Text("Devices")
                } footer: {
                    Text("Devices running TermPod on your account. Tap a device to see its terminal sessions.")
                }
            }
            .animation(.default, value: deviceService.devices.count)
            .navigationTitle("TermPod")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        if let email = auth.email {
                            Text(email)
                        }

                        Button(role: .destructive) {
                            Task {
                                await deviceService.markOffline(auth: auth)
                                auth.logout()
                            }
                        } label: {
                            Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                        }
                    } label: {
                        Image(systemName: "person.circle")
                    }
                    .accessibilityLabel("Account menu")
                }

                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showSettings = true
                    } label: {
                        Image(systemName: "gearshape")
                    }
                    .accessibilityLabel("Settings")
                }
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
            }
            .navigationDestination(for: String.self) { deviceId in
                if let device = deviceService.devices.first(where: { $0.id == deviceId }) {
                    DeviceSessionsView(device: device)
                }
            }
            .refreshable {
                await deviceService.fetchDevices(auth: auth)
            }
            .task {
                startBonjourBrowse()
                await deviceService.registerThisDevice(auth: auth)
                await deviceService.fetchDevices(auth: auth)
            }
            .onDisappear {
                bonjourBrowser?.cancel()
                bonjourBrowser = nil
            }
        }
    }

    private var devicesWithLocalStatus: [DeviceService.Device] {
        deviceService.devices.map { device in
            // Override online status for desktop devices when Bonjour detects them
            if device.platform == "macos" && localDesktopFound {
                return DeviceService.Device(
                    id: device.id,
                    name: device.name,
                    deviceType: device.deviceType,
                    platform: device.platform,
                    isOnline: true,
                    lastSeenAt: device.lastSeenAt
                )
            }

            // Mark desktop offline if Bonjour doesn't see it
            if device.platform == "macos" && !localDesktopFound && device.isOnline {
                return DeviceService.Device(
                    id: device.id,
                    name: device.name,
                    deviceType: device.deviceType,
                    platform: device.platform,
                    isOnline: false,
                    lastSeenAt: device.lastSeenAt
                )
            }

            return device
        }
    }

    private func transportForDevice(_ device: DeviceService.Device) -> TransportType? {
        guard device.isOnline else { return nil }

        if device.platform == "macos" && localDesktopFound { return .local }

        // Check if any active session to this device has a P2P transport.
        // We match by checking active WebRTC connections — these are always
        // to the single desktop device in the current architecture.
        let hasP2P = appState.sessions.contains { $0.connection.hasP2PTransport }
        if hasP2P { return .webrtc }

        // Device is online per relay API
        return .relay
    }

    private func startBonjourBrowse() {
        let params = NWParameters()
        params.includePeerToPeer = true

        let browser = NWBrowser(for: .bonjour(type: "_termpod._tcp", domain: "local."), using: params)

        browser.browseResultsChangedHandler = { results, _ in
            Task { @MainActor in
                localDesktopFound = !results.isEmpty
            }
        }

        browser.stateUpdateHandler = { _ in }
        browser.start(queue: .main)
        bonjourBrowser = browser
    }
}

// MARK: - Device Row

struct DeviceRow: View {

    let device: DeviceService.Device
    var transport: TransportType?

    private var transportColor: Color {
        guard let transport else { return .secondary }
        return switch transport {
        case .local: .green
        case .webrtc: .blue
        case .relay: .orange
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: device.systemImage)
                .font(.title2)
                .foregroundStyle(device.isOnline ? transportColor : .secondary)
                .frame(width: 32)

            VStack(alignment: .leading, spacing: 2) {
                Text(device.displayName)
                    .font(.headline)

                HStack(spacing: 4) {
                    if device.isOnline {
                        Circle()
                            .fill(transportColor)
                            .frame(width: 6, height: 6)

                        if let transport {
                            Text(transport.label)
                                .font(.caption)
                        }
                    } else {
                        Image(systemName: "xmark.circle")
                            .font(.caption2)
                        Text("Offline")
                            .font(.caption)
                    }
                }
                .foregroundStyle(device.isOnline ? transportColor : .secondary)
            }

            Spacer()
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(device.displayName), \(device.isOnline ? (transport?.label ?? "online") : "offline")")
    }
}
