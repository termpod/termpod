import Foundation
import XCTest
@testable import TermPod

final class DeviceModelTests: XCTestCase {

    // MARK: - Device

    func testDeviceDisplayNameUsesNameWhenNotEmpty() {
        let device = DeviceService.Device(
            id: "d1",
            name: "Swapnil's MacBook",
            deviceType: "desktop",
            platform: "macos",
            isOnline: true,
            lastSeenAt: nil
        )
        XCTAssertEqual(device.displayName, "Swapnil's MacBook")
    }

    func testDeviceDisplayNameFallsBackToPlatform() {
        let device = DeviceService.Device(
            id: "d2",
            name: "",
            deviceType: "phone",
            platform: "ios",
            isOnline: false,
            lastSeenAt: nil
        )
        XCTAssertEqual(device.displayName, "ios device")
    }

    func testDeviceSystemImageMacOS() {
        let device = DeviceService.Device(
            id: "d3",
            name: "Mac",
            deviceType: "desktop",
            platform: "macos",
            isOnline: true,
            lastSeenAt: nil
        )
        XCTAssertEqual(device.systemImage, "desktopcomputer")
    }

    func testDeviceSystemImageIOS() {
        let device = DeviceService.Device(
            id: "d4",
            name: "iPhone",
            deviceType: "phone",
            platform: "ios",
            isOnline: true,
            lastSeenAt: nil
        )
        XCTAssertEqual(device.systemImage, "iphone")
    }

    func testDeviceSystemImageIpad() {
        let device = DeviceService.Device(
            id: "d4b",
            name: "iPad",
            deviceType: "mobile",
            platform: "ipad",
            isOnline: true,
            lastSeenAt: nil
        )
        XCTAssertEqual(device.systemImage, "ipad")
    }

    func testDeviceSystemImageUnknownPlatform() {
        let device = DeviceService.Device(
            id: "d5",
            name: "Other",
            deviceType: "unknown",
            platform: "linux",
            isOnline: false,
            lastSeenAt: nil
        )
        XCTAssertEqual(device.systemImage, "terminal")
    }

    func testDeviceIdentifiable() {
        let device = DeviceService.Device(
            id: "unique-id",
            name: "Test",
            deviceType: "desktop",
            platform: "macos",
            isOnline: true,
            lastSeenAt: "2024-01-01"
        )
        XCTAssertEqual(device.id, "unique-id")
    }

    func testDeviceHashable() {
        let d1 = DeviceService.Device(id: "a", name: "A", deviceType: "desktop", platform: "macos", isOnline: true, lastSeenAt: nil)
        let d2 = DeviceService.Device(id: "a", name: "A", deviceType: "desktop", platform: "macos", isOnline: true, lastSeenAt: nil)
        let d3 = DeviceService.Device(id: "b", name: "B", deviceType: "phone", platform: "ios", isOnline: false, lastSeenAt: nil)

        XCTAssertEqual(d1, d2)
        XCTAssertNotEqual(d1, d3)
    }

    func testDeviceCodable() throws {
        let device = DeviceService.Device(
            id: "cod-1",
            name: "Codable Test",
            deviceType: "desktop",
            platform: "macos",
            isOnline: true,
            lastSeenAt: "2024-06-15T10:30:00Z"
        )

        let data = try JSONEncoder().encode(device)
        let decoded = try JSONDecoder().decode(DeviceService.Device.self, from: data)

        XCTAssertEqual(decoded.id, device.id)
        XCTAssertEqual(decoded.name, device.name)
        XCTAssertEqual(decoded.deviceType, device.deviceType)
        XCTAssertEqual(decoded.platform, device.platform)
        XCTAssertEqual(decoded.isOnline, device.isOnline)
        XCTAssertEqual(decoded.lastSeenAt, device.lastSeenAt)
    }

    // MARK: - DeviceSession

    func testDeviceSessionEquatable() {
        let s1 = DeviceService.DeviceSession(id: "s1", name: "zsh", cwd: "/home", processName: "zsh", ptyCols: 80, ptyRows: 24)
        let s2 = DeviceService.DeviceSession(id: "s1", name: "zsh", cwd: "/home", processName: "zsh", ptyCols: 80, ptyRows: 24)
        let s3 = DeviceService.DeviceSession(id: "s2", name: "bash", cwd: "/tmp", processName: nil, ptyCols: 120, ptyRows: 40)

        XCTAssertEqual(s1, s2)
        XCTAssertNotEqual(s1, s3)
    }

    func testDeviceSessionCodable() throws {
        let session = DeviceService.DeviceSession(
            id: "sess-1",
            name: "Shell",
            cwd: "/Users/test",
            processName: "vim",
            ptyCols: 132,
            ptyRows: 43
        )

        let data = try JSONEncoder().encode(session)
        let decoded = try JSONDecoder().decode(DeviceService.DeviceSession.self, from: data)

        XCTAssertEqual(decoded.id, session.id)
        XCTAssertEqual(decoded.name, session.name)
        XCTAssertEqual(decoded.cwd, session.cwd)
        XCTAssertEqual(decoded.processName, session.processName)
        XCTAssertEqual(decoded.ptyCols, session.ptyCols)
        XCTAssertEqual(decoded.ptyRows, session.ptyRows)
    }

    func testDeviceSessionNilProcessName() throws {
        let session = DeviceService.DeviceSession(
            id: "s-nil",
            name: "Tab 1",
            cwd: "~",
            processName: nil,
            ptyCols: 80,
            ptyRows: 24
        )

        let data = try JSONEncoder().encode(session)
        let decoded = try JSONDecoder().decode(DeviceService.DeviceSession.self, from: data)
        XCTAssertNil(decoded.processName)
    }

    func testDeviceSessionDecodesRelayMinimalPayload() throws {
        let data = """
        {
          "sessions": [
            {
              "id": "sess-1",
              "deviceId": "dev-1",
              "ptyCols": 132,
              "ptyRows": 43,
              "createdAt": "2026-03-11T18:00:00Z"
            }
          ]
        }
        """.data(using: .utf8)!

        struct SessionsResponse: Codable {
            let sessions: [DeviceService.DeviceSession]
        }

        let decoded = try JSONDecoder().decode(SessionsResponse.self, from: data)

        XCTAssertEqual(decoded.sessions.count, 1)
        XCTAssertEqual(decoded.sessions[0].id, "sess-1")
        XCTAssertEqual(decoded.sessions[0].name, "Shell")
        XCTAssertEqual(decoded.sessions[0].cwd, "~")
        XCTAssertNil(decoded.sessions[0].processName)
        XCTAssertEqual(decoded.sessions[0].ptyCols, 132)
        XCTAssertEqual(decoded.sessions[0].ptyRows, 43)
    }
}
