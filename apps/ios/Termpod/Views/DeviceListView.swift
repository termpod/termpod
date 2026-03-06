import SwiftUI
import Network

struct DeviceListView: View {

    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var auth: AuthService
    @EnvironmentObject private var deviceService: DeviceService
    @State private var localDesktopFound = false
    @State private var bonjourBrowser: NWBrowser?
    var body: some View {
        NavigationStack {
            List {
                // Registered devices
                Section {
                    if deviceService.loading {
                        HStack {
                            Spacer()
                            ProgressView()
                            Spacer()
                        }
                    } else if deviceService.devices.isEmpty {
                        ContentUnavailableView {
                            Label("No Devices", systemImage: "desktopcomputer")
                        } description: {
                            Text("Open Termpod on your Mac to register a device.")
                        }
                        .listRowBackground(Color.clear)
                    } else {
                        ForEach(devicesWithLocalStatus) { device in
                            NavigationLink(destination: DeviceSessionsView(device: device)) {
                                DeviceRow(device: device)
                            }
                        }
                    }
                } header: {
                    Text("Devices")
                } footer: {
                    Text("Devices running Termpod on your account. Tap a device to see its terminal sessions.")
                }
            }
            .animation(.default, value: deviceService.devices.count)
            .navigationTitle("Termpod")
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

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: device.systemImage)
                .font(.title2)
                .foregroundStyle(device.isOnline ? .green : .secondary)
                .frame(width: 32)

            VStack(alignment: .leading, spacing: 2) {
                Text(device.displayName)
                    .font(.headline)

                HStack(spacing: 4) {
                    Image(systemName: device.isOnline ? "checkmark.circle.fill" : "xmark.circle")
                        .font(.caption2)
                    Text(device.isOnline ? "Online" : "Offline")
                        .font(.caption)
                }
                .foregroundStyle(device.isOnline ? .green : .secondary)
            }

            Spacer()
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(device.displayName), \(device.isOnline ? "online" : "offline")")
    }
}
