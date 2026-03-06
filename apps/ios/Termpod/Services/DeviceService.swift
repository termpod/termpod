import Foundation
import UIKit

/// Manages device registration, heartbeat, and session discovery.
@MainActor
final class DeviceService: ObservableObject {

    struct Device: Identifiable, Codable {
        let id: String
        let name: String
        let deviceType: String
        let platform: String
        let isOnline: Bool
        let lastSeenAt: String?

        var displayName: String {
            name.isEmpty ? "\(platform) device" : name
        }

        var systemImage: String {
            switch platform {
            case "macos": return "desktopcomputer"
            case "ios": return "iphone"
            default: return "terminal"
            }
        }
    }

    struct DeviceSession: Identifiable, Codable {
        let id: String
        let name: String
        let cwd: String
        let ptyCols: Int
        let ptyRows: Int
    }

    private struct DevicesResponse: Codable {
        let devices: [Device]
    }

    private struct SessionsResponse: Codable {
        let sessions: [DeviceSession]
    }

    @Published var devices: [Device] = []
    @Published var loading = false

    private var heartbeatTask: Task<Void, Never>?

    private var deviceId: String {
        if let stored = UserDefaults.standard.string(forKey: "termpod-device-id") {
            return stored
        }

        let id = UUID().uuidString
        UserDefaults.standard.set(id, forKey: "termpod-device-id")
        return id
    }

    // MARK: - Device Registration

    func registerThisDevice(auth: AuthService) async {
        guard auth.isAuthenticated else { return }

        let name = UIDevice.current.name
        let platform = "ios"
        let deviceType = UIDevice.current.userInterfaceIdiom == .pad ? "tablet" : "phone"

        do {
            let (_, response) = try await auth.apiFetch(
                path: "/devices",
                method: "POST",
                body: [
                    "id": deviceId,
                    "name": name,
                    "deviceType": deviceType,
                    "platform": platform,
                ]
            )

            if response.statusCode == 200 || response.statusCode == 201 {
                startHeartbeat(auth: auth)
            }
        } catch {
            print("[DeviceService] Registration failed: \(error)")
        }
    }

    func markOffline(auth: AuthService) async {
        heartbeatTask?.cancel()
        heartbeatTask = nil

        guard auth.isAuthenticated else { return }
        _ = try? await auth.apiFetch(
            path: "/devices/\(deviceId)/offline",
            method: "POST"
        )
    }

    // MARK: - Device Discovery

    func fetchDevices(auth: AuthService) async {
        guard auth.isAuthenticated else { return }

        loading = true

        do {
            let (data, response) = try await auth.apiFetch(path: "/devices")

            if response.statusCode == 200 {
                let wrapper = try JSONDecoder().decode(DevicesResponse.self, from: data)
                devices = wrapper.devices
            }
        } catch {
            print("[DeviceService] Fetch devices failed: \(error)")
        }

        loading = false
    }

    func fetchSessions(auth: AuthService, deviceId: String) async -> [DeviceSession] {
        guard auth.isAuthenticated else { return [] }

        do {
            let (data, response) = try await auth.apiFetch(path: "/devices/\(deviceId)/sessions")

            if response.statusCode == 200 {
                let wrapper = try JSONDecoder().decode(SessionsResponse.self, from: data)
                return wrapper.sessions
            }
        } catch {
            print("[DeviceService] Fetch sessions failed: \(error)")
        }

        return []
    }

    // MARK: - Remote Session Creation

    func requestSession(auth: AuthService, deviceId: String) async {
        guard auth.isAuthenticated else { return }

        do {
            let _ = try await auth.apiFetch(
                path: "/devices/\(deviceId)/request-session",
                method: "POST",
                body: ["requestedBy": UIDevice.current.name]
            )
        } catch {
            print("[DeviceService] Request session failed: \(error)")
        }
    }

    // MARK: - Heartbeat

    private func startHeartbeat(auth: AuthService) {
        heartbeatTask?.cancel()
        heartbeatTask = Task { [deviceId] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                guard !Task.isCancelled, auth.isAuthenticated else { break }
                _ = try? await auth.apiFetch(
                    path: "/devices/\(deviceId)/heartbeat",
                    method: "POST"
                )
            }
        }
    }
}
