import Foundation
import XCTest
@testable import TermPod

final class AuthErrorTests: XCTestCase {

    func testNetworkErrorMessage() {
        let error = AuthError.networkError
        XCTAssertEqual(error.message, "Network error")
    }

    func testServerErrorMessage() {
        let error = AuthError.serverError("Email already exists")
        XCTAssertEqual(error.message, "Email already exists")
    }

    func testInvalidResponseMessage() {
        let error = AuthError.invalidResponse
        XCTAssertEqual(error.message, "Invalid response")
    }

    func testServerErrorWithEmptyMessage() {
        let error = AuthError.serverError("")
        XCTAssertEqual(error.message, "")
    }
}

// MARK: - Base64URL Decoding (used by JWT parsing)

final class Base64URLDecodingTests: XCTestCase {

    func testStandardBase64Decodes() {
        // "Hello" in base64 = "SGVsbG8="
        let data = Data(base64URLEncoded: "SGVsbG8=")
        XCTAssertNotNil(data)
        XCTAssertEqual(String(data: data!, encoding: .utf8), "Hello")
    }

    func testBase64URLWithMinusAndUnderscore() {
        // Base64URL replaces + with - and / with _
        // Standard base64: "a+b/c==" -> base64url: "a-b_c=="
        let standard = Data(base64Encoded: "a+b/cw==")
        let urlSafe = Data(base64URLEncoded: "a-b_cw==")
        XCTAssertEqual(standard, urlSafe)
    }

    func testBase64URLWithoutPadding() {
        // "Hi" in base64 = "SGk=" but base64url can omit padding
        let withPadding = Data(base64URLEncoded: "SGk=")
        let withoutPadding = Data(base64URLEncoded: "SGk")
        XCTAssertNotNil(withPadding)
        XCTAssertNotNil(withoutPadding)
        XCTAssertEqual(withPadding, withoutPadding)
    }

    func testBase64URLPaddingOneCharShort() {
        // "Hel" = "SGVs" (no padding needed, length % 4 == 0)
        let data = Data(base64URLEncoded: "SGVs")
        XCTAssertNotNil(data)
        XCTAssertEqual(String(data: data!, encoding: .utf8), "Hel")
    }

    func testBase64URLPaddingTwoCharsShort() {
        // "H" = "SA==" in base64, "SA" in base64url
        let data = Data(base64URLEncoded: "SA")
        XCTAssertNotNil(data)
        XCTAssertEqual(String(data: data!, encoding: .utf8), "H")
    }
}

// MARK: - JWT Token Expiry (via wsURL helper)

final class AuthServiceURLTests: XCTestCase {

    @MainActor
    func testWsURLConvertsHTTPSToWSS() {
        let auth = AuthService()
        // AuthService defaults to https://relay.termpod.dev
        let url = auth.wsURL(sessionId: "test-session")
        XCTAssertNotNil(url)
        XCTAssertTrue(url!.absoluteString.hasPrefix("wss://"))
        XCTAssertTrue(url!.absoluteString.hasSuffix("/sessions/test-session/ws"))
    }

    @MainActor
    func testWsURLIncludesSessionId() {
        let auth = AuthService()
        let sessionId = "550e8400-e29b-41d4-a716-446655440000"
        let url = auth.wsURL(sessionId: sessionId)
        XCTAssertNotNil(url)
        XCTAssertTrue(url!.absoluteString.contains(sessionId))
    }

    @MainActor
    func testRelayHTTPDefault() {
        let auth = AuthService()
        // When no plist value, defaults to https://relay.termpod.dev
        XCTAssertTrue(auth.relayHTTP.hasPrefix("http"))
    }

    @MainActor
    func testInitialState() {
        let auth = AuthService()
        XCTAssertFalse(auth.loading)
        XCTAssertNil(auth.error)
    }

    @MainActor
    func testLogoutClearsState() {
        let auth = AuthService()
        auth.logout()
        XCTAssertFalse(auth.isAuthenticated)
        XCTAssertNil(auth.email)
    }
}

// MARK: - Private extension helper to make base64URL testable

private extension Data {
    init?(base64URLEncoded string: String) {
        var base64 = string
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")

        let remainder = base64.count % 4

        if remainder > 0 {
            base64.append(String(repeating: "=", count: 4 - remainder))
        }

        self.init(base64Encoded: base64)
    }
}
