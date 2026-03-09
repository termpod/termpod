import Foundation
import XCTest
@testable import TermPod

final class ClipTests: XCTestCase {

    func testClipInitDefaults() {
        let clip = Clip(name: "Deploy", command: "ssh prod deploy")
        XCTAssertFalse(clip.id.uuidString.isEmpty)
        XCTAssertEqual(clip.name, "Deploy")
        XCTAssertEqual(clip.command, "ssh prod deploy")
    }

    func testClipEquatable() {
        let id = UUID()
        let date = Date()
        let c1 = Clip(id: id, name: "A", command: "ls", createdAt: date)
        let c2 = Clip(id: id, name: "A", command: "ls", createdAt: date)
        let c3 = Clip(id: UUID(), name: "B", command: "pwd", createdAt: date)

        XCTAssertEqual(c1, c2)
        XCTAssertNotEqual(c1, c3)
    }

    func testClipCodable() throws {
        let clip = Clip(name: "Test", command: "echo hello")

        let data = try JSONEncoder().encode(clip)
        let decoded = try JSONDecoder().decode(Clip.self, from: data)

        XCTAssertEqual(decoded.id, clip.id)
        XCTAssertEqual(decoded.name, clip.name)
        XCTAssertEqual(decoded.command, clip.command)
    }

    func testClipArrayCodable() throws {
        let clips = [
            Clip(name: "First", command: "ls -la"),
            Clip(name: "Second", command: "git status"),
            Clip(name: "Third", command: "docker ps"),
        ]

        let data = try JSONEncoder().encode(clips)
        let decoded = try JSONDecoder().decode([Clip].self, from: data)

        XCTAssertEqual(decoded.count, 3)
        XCTAssertEqual(decoded[0].name, "First")
        XCTAssertEqual(decoded[1].command, "git status")
        XCTAssertEqual(decoded[2].name, "Third")
    }

    func testClipIdentifiable() {
        let id = UUID()
        let clip = Clip(id: id, name: "X", command: "Y")
        XCTAssertEqual(clip.id, id)
    }

    func testClipWithEmptyFields() {
        let clip = Clip(name: "", command: "")
        XCTAssertEqual(clip.name, "")
        XCTAssertEqual(clip.command, "")
    }

    func testClipWithMultilineCommand() throws {
        let command = """
        for i in $(seq 1 10); do
            echo $i
        done
        """
        let clip = Clip(name: "Loop", command: command)

        let data = try JSONEncoder().encode(clip)
        let decoded = try JSONDecoder().decode(Clip.self, from: data)
        XCTAssertEqual(decoded.command, command)
    }
}
