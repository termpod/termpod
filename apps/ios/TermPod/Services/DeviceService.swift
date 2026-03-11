import Foundation
import UIKit

/// Manages device registration, heartbeat, and session discovery.
@MainActor
final class DeviceService: ObservableObject {

    struct Device: Identifiable, Codable, Hashable {
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
            case "iphone", "ios": return "iphone"
            case "ipad": return "ipad"
            default: return "terminal"
            }
        }
    }

    struct DeviceSession: Identifiable, Codable, Equatable {
        let id: String
        let name: String
        let cwd: String
        let processName: String?
        let ptyCols: Int
        let ptyRows: Int

        private enum CodingKeys: String, CodingKey {
            case id
            case name
            case cwd
            case processName
            case process_name
            case ptyCols
            case ptyRows
        }

        init(id: String, name: String, cwd: String, processName: String?, ptyCols: Int, ptyRows: Int) {
            self.id = id
            self.name = name
            self.cwd = cwd
            self.processName = processName
            self.ptyCols = ptyCols
            self.ptyRows = ptyRows
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)

            id = try container.decode(String.self, forKey: .id)
            name = try container.decodeIfPresent(String.self, forKey: .name) ?? "Shell"
            cwd = try container.decodeIfPresent(String.self, forKey: .cwd) ?? "~"
            processName = try container.decodeIfPresent(String.self, forKey: .processName)
                ?? container.decodeIfPresent(String.self, forKey: .process_name)
            ptyCols = try container.decodeIfPresent(Int.self, forKey: .ptyCols) ?? 80
            ptyRows = try container.decodeIfPresent(Int.self, forKey: .ptyRows) ?? 24
        }

        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)

            try container.encode(id, forKey: .id)
            try container.encode(name, forKey: .name)
            try container.encode(cwd, forKey: .cwd)
            try container.encodeIfPresent(processName, forKey: .processName)
            try container.encode(ptyCols, forKey: .ptyCols)
            try container.encode(ptyRows, forKey: .ptyRows)
        }
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
        let platform = UIDevice.current.userInterfaceIdiom == .pad ? "ipad" : "iphone"
        let deviceType = "mobile"

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
            let _ = error
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
            let _ = error
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
            let _ = error
        }

        return []
    }

    // MARK: - Session Deletion

    func deleteSession(auth: AuthService, sessionId: String) async -> Bool {
        guard auth.isAuthenticated else { return false }

        do {
            let (_, response) = try await auth.apiFetch(
                path: "/sessions/\(sessionId)",
                method: "DELETE"
            )

            return response.statusCode == 200
        } catch {
            return false
        }
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
            let _ = error
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
