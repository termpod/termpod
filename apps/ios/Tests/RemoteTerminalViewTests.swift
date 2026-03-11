import Foundation
import XCTest
@testable import TermPod

final class RemoteTerminalViewTests: XCTestCase {

    func testDetectsCursorHomeThenEraseDisplay() {
        let data = Data([0x1B, 0x5B, 0x48, 0x1B, 0x5B, 0x32, 0x4A])

        XCTAssertTrue(RemoteTerminalView.containsClearSequence(in: data))
    }

    func testDetectsEraseDisplayThenCursorHome() {
        let data = Data([0x1B, 0x5B, 0x33, 0x4A, 0x1B, 0x5B, 0x48])

        XCTAssertTrue(RemoteTerminalView.containsClearSequence(in: data))
    }

    func testIgnoresRegularTerminalOutput() {
        let data = Data("hello world\r\n".utf8)

        XCTAssertFalse(RemoteTerminalView.containsClearSequence(in: data))
    }
}
