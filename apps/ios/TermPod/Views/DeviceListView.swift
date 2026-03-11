import SwiftUI

struct DeviceListView: View {

    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var auth: AuthService
    @EnvironmentObject private var deviceService: DeviceService
    @EnvironmentObject private var deviceTransport: DeviceTransportManager
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
                        ForEach(deviceService.devices) { device in
                            NavigationLink(value: device.id) {
                                DeviceRow(
                                    device: device,
                                    transport: transportForDevice(device),
                                    webrtcMode: deviceTransport.webrtcMode,
                                    isConnecting: isConnectingDevice(device)
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
                                deviceTransport.stop()
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
                        .onAppear {
                            startTransportForDevice(deviceId)
                        }
                }
            }
            .refreshable {
                await deviceService.fetchDevices(auth: auth)
                autoConnectFirstDevice()
            }
            .task {
                deviceTransport.startDiscovery()
                await deviceService.registerThisDevice(auth: auth)
                await deviceService.fetchDevices(auth: auth)
                // Auto-connect to the first online device so P2P is
                // established before the user navigates to a session.
                autoConnectFirstDevice()
            }
            .onReceive(NotificationCenter.default.publisher(for: .desktopConnected)) { _ in
                Task { await deviceService.fetchDevices(auth: auth) }
            }
            .onChange(of: deviceTransport.desktopOnline) { _, online in
                if !online {
                    Task { await deviceService.fetchDevices(auth: auth) }
                }
            }
        }
    }

    private func transportForDevice(_ device: DeviceService.Device) -> TransportType? {
        guard deviceTransport.desktopOnline else { return nil }

        if deviceTransport.isConnected {
            return deviceTransport.activeTransport
        }

        return .relay
    }

    private func isConnectingDevice(_ device: DeviceService.Device) -> Bool {
        (device.isOnline || deviceTransport.desktopOnline) && deviceTransport.isConnecting && !deviceTransport.isConnected
    }

    private func startTransportForDevice(_ deviceId: String) {
        Task {
            guard let token = await auth.validAccessToken() else { return }
            deviceTransport.start(deviceId: deviceId, relayBaseURL: auth.relayHTTP, token: token)
        }
    }

    /// Connect device WS to the first online desktop so P2P can
    /// establish before the user taps into a session.
    private func autoConnectFirstDevice() {
        guard !deviceTransport.isConnected,
              let device = deviceService.devices.first(where: { $0.isOnline })
        else { return }

        startTransportForDevice(device.id)
    }
}

// MARK: - Device Row

struct DeviceRow: View {

    let device: DeviceService.Device
    var transport: TransportType?
    var webrtcMode: WebRTCConnectionMode?
    var isConnecting: Bool = false

    /// Use transport presence as the source of truth for online status,
    /// falling back to the HTTP API's device.isOnline. This ensures the
    /// card updates immediately when `client_joined` arrives via Device WS
    /// without waiting for an HTTP refresh.
    private var isOnline: Bool {
        transport != nil || isConnecting || device.isOnline
    }

    private var transportColor: Color {
        guard let transport, !isConnecting else { return .secondary }
        return switch transport {
        case .local: .green
        case .webrtc: .blue
        case .relay: .orange
        }
    }

    private var transportLabel: String {
        guard let transport else { return "" }
        if transport == .webrtc, let mode = webrtcMode {
            return "P2P · \(mode.rawValue)"
        }
        return transport.label
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: device.systemImage)
                .font(.title2)
                .foregroundStyle(isOnline ? transportColor : .secondary)
                .frame(width: 32)

            VStack(alignment: .leading, spacing: 2) {
                Text(device.displayName)
                    .font(.headline)

                HStack(spacing: 4) {
                    if isOnline {
                        if isConnecting {
                            ProgressView()
                                .controlSize(.mini)
                        } else {
                            Circle()
                                .fill(transportColor)
                                .frame(width: 6, height: 6)
                        }

                        if transport != nil {
                            Text(transportLabel)
                                .font(.caption)
                        }
                    } else {
                        Image(systemName: "xmark.circle")
                            .font(.caption2)
                        Text("Offline")
                            .font(.caption)
                    }
                }
                .foregroundStyle(isOnline ? transportColor : .secondary)
            }

            Spacer()
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(device.displayName), \(isConnecting ? "connecting \(transportLabel)" : isOnline ? transportLabel : "offline")")
    }
}
