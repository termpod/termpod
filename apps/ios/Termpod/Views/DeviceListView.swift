import SwiftUI

struct DeviceListView: View {

    @EnvironmentObject private var appState: AppState
    @EnvironmentObject private var auth: AuthService
    @EnvironmentObject private var deviceService: DeviceService
    @State private var showScanner = false

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
                        ForEach(deviceService.devices) { device in
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

                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showScanner = true
                    } label: {
                        Image(systemName: "qrcode.viewfinder")
                    }
                    .accessibilityLabel("Scan QR code")
                    .accessibilityHint("Scan a QR code from your Mac to connect")
                }
            }
            .refreshable {
                await deviceService.fetchDevices(auth: auth)
            }
            .task {
                await deviceService.registerThisDevice(auth: auth)
                await deviceService.fetchDevices(auth: auth)
            }
            .sheet(isPresented: $showScanner) {
                PairingScannerView { token in
                    appState.pairWithToken(token, auth: auth)
                    showScanner = false
                }
            }
        }
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
