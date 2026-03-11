import Foundation
import XCTest
@testable import TermPod

final class CryptoServiceTests: XCTestCase {

    // MARK: - Key Pair Generation

    func testGenerateKeyPairReturnsValidJwk() {
        let crypto = CryptoService()
        let jwk = crypto.generateKeyPair()

        XCTAssertEqual(jwk["kty"] as? String, "EC")
        XCTAssertEqual(jwk["crv"] as? String, "P-256")
        XCTAssertNotNil(jwk["x"] as? String)
        XCTAssertNotNil(jwk["y"] as? String)

        // P-256 coordinates are 32 bytes → base64url ~43 chars
        let x = jwk["x"] as! String
        let y = jwk["y"] as! String
        XCTAssertGreaterThan(x.count, 0)
        XCTAssertGreaterThan(y.count, 0)
    }

    func testGenerateKeyPairProducesDifferentKeysEachTime() {
        let crypto1 = CryptoService()
        let crypto2 = CryptoService()

        let jwk1 = crypto1.generateKeyPair()
        let jwk2 = crypto2.generateKeyPair()

        // Different key pairs should have different x coordinates
        XCTAssertNotEqual(jwk1["x"] as? String, jwk2["x"] as? String)
    }

    // MARK: - isReady

    func testIsReadyFalseBeforeKeyDerivation() {
        let crypto = CryptoService()
        XCTAssertFalse(crypto.isReady)
    }

    func testIsReadyTrueAfterKeyDerivation() throws {
        let (alice, _) = try setupPair(sessionId: "test")
        XCTAssertTrue(alice.isReady)
    }

    // MARK: - Key Exchange & Derivation

    func testDeriveSessionKeyWithValidPeerKey() throws {
        let alice = CryptoService()
        let bob = CryptoService()

        let aliceJwk = alice.generateKeyPair()
        let bobJwk = bob.generateKeyPair()

        XCTAssertNoThrow(try alice.deriveSessionKey(peerPublicKeyJwk: bobJwk, sessionId: "sess-1"))
        XCTAssertNoThrow(try bob.deriveSessionKey(peerPublicKeyJwk: aliceJwk, sessionId: "sess-1"))

        XCTAssertTrue(alice.isReady)
        XCTAssertTrue(bob.isReady)
    }

    func testDeriveSessionKeyWithoutKeyPairThrows() {
        let crypto = CryptoService()
        let fakeJwk: [String: Any] = ["kty": "EC", "crv": "P-256", "x": "AAAA", "y": "BBBB"]

        XCTAssertThrowsError(try crypto.deriveSessionKey(peerPublicKeyJwk: fakeJwk, sessionId: "s")) { error in
            XCTAssertTrue(error is CryptoService.CryptoError)
        }
    }

    func testDeriveSessionKeyWithInvalidPeerKeyThrows() {
        let crypto = CryptoService()
        _ = crypto.generateKeyPair()

        let badJwk: [String: Any] = ["kty": "EC", "crv": "P-256"]
        XCTAssertThrowsError(try crypto.deriveSessionKey(peerPublicKeyJwk: badJwk, sessionId: "s"))
    }

    // MARK: - Encrypt / Decrypt Round Trip

    func testEncryptDecryptRoundTrip() throws {
        let (alice, bob) = try setupPair(sessionId: "sess-roundtrip")

        let plaintext = Data("Hello, World!".utf8)
        let encrypted = try alice.encrypt(plaintext)
        let decrypted = try bob.decrypt(encrypted)

        XCTAssertEqual(decrypted, plaintext)
    }

    func testEncryptDecryptLargePayload() throws {
        let (alice, bob) = try setupPair(sessionId: "sess-large")

        // Simulate a large terminal output (100KB)
        let plaintext = Data(repeating: 0x42, count: 100_000)
        let encrypted = try alice.encrypt(plaintext)
        let decrypted = try bob.decrypt(encrypted)

        XCTAssertEqual(decrypted, plaintext)
    }

    func testEncryptDecryptEmptyPayload() throws {
        let (alice, bob) = try setupPair(sessionId: "sess-empty")

        let plaintext = Data()
        let encrypted = try alice.encrypt(plaintext)
        let decrypted = try bob.decrypt(encrypted)

        XCTAssertEqual(decrypted, plaintext)
    }

    func testBidirectionalEncryption() throws {
        let (alice, bob) = try setupPair(sessionId: "sess-bidir")

        // Alice → Bob
        let msg1 = Data("from alice".utf8)
        let enc1 = try alice.encrypt(msg1)
        XCTAssertEqual(try bob.decrypt(enc1), msg1)

        // Bob → Alice
        let msg2 = Data("from bob".utf8)
        let enc2 = try bob.encrypt(msg2)
        XCTAssertEqual(try alice.decrypt(enc2), msg2)
    }

    func testMultipleMessagesInSequence() throws {
        let (alice, bob) = try setupPair(sessionId: "sess-seq")

        for i in 0..<10 {
            let msg = Data("message \(i)".utf8)
            let encrypted = try alice.encrypt(msg)
            let decrypted = try bob.decrypt(encrypted)
            XCTAssertEqual(decrypted, msg)
        }
    }

    // MARK: - Encrypted Frame Format

    func testEncryptedFrameContainsNonceAndCiphertext() throws {
        let (alice, _) = try setupPair(sessionId: "sess-format")

        let plaintext = Data("test".utf8)
        let encrypted = try alice.encrypt(plaintext)

        // Frame: [nonce:12][ciphertext][tag:16]
        // Minimum: 12 (nonce) + 0 (empty ciphertext) + 16 (tag) = 28
        XCTAssertGreaterThanOrEqual(encrypted.count, 12 + 16)

        // For "test" (4 bytes): 12 + 4 + 16 = 32
        XCTAssertEqual(encrypted.count, 12 + plaintext.count + 16)
    }

    func testFirstNonceIsCounterZero() throws {
        let (alice, _) = try setupPair(sessionId: "sess-nonce")

        let encrypted = try alice.encrypt(Data("a".utf8))
        let nonce = encrypted[0..<12]

        // Counter 0 → all 12 bytes should be zero
        XCTAssertEqual(nonce, Data(count: 12))
    }

    func testNonceIncrementsWithEachMessage() throws {
        let (alice, _) = try setupPair(sessionId: "sess-inc")

        let enc1 = try alice.encrypt(Data("a".utf8))
        let enc2 = try alice.encrypt(Data("b".utf8))

        let nonce1 = enc1[0..<12]
        let nonce2 = enc2[0..<12]

        // Nonces should differ (counter 0 vs counter 1)
        XCTAssertNotEqual(nonce1, nonce2)

        // Counter 1: last byte should be 1
        XCTAssertEqual(nonce2[11], 1)
    }

    // MARK: - Tampering Detection

    func testTamperedCiphertextFailsDecryption() throws {
        let (alice, bob) = try setupPair(sessionId: "sess-tamper")

        var encrypted = try alice.encrypt(Data("secret".utf8))

        // Flip a bit in the ciphertext (after nonce)
        encrypted[15] ^= 0xFF

        XCTAssertThrowsError(try bob.decrypt(encrypted))
    }

    func testTamperedNonceFailsDecryption() throws {
        let (alice, bob) = try setupPair(sessionId: "sess-tamper-nonce")

        var encrypted = try alice.encrypt(Data("secret".utf8))

        // Flip a bit in the nonce
        encrypted[0] ^= 0xFF

        XCTAssertThrowsError(try bob.decrypt(encrypted))
    }

    func testFrameTooShortThrows() throws {
        let (_, bob) = try setupPair(sessionId: "sess-short")

        // Less than 28 bytes (12 nonce + 16 tag minimum)
        let shortFrame = Data(count: 10)

        XCTAssertThrowsError(try bob.decrypt(shortFrame)) { error in
            guard let cryptoError = error as? CryptoService.CryptoError else {
                XCTFail("Expected CryptoError")
                return
            }
            XCTAssertEqual(cryptoError, .frameTooShort)
        }
    }

    // MARK: - Session Isolation

    func testDifferentSessionIdsCantDecrypt() throws {
        let alice = CryptoService()
        let bob = CryptoService()

        let aliceJwk = alice.generateKeyPair()
        let bobJwk = bob.generateKeyPair()

        // Same key pair but different session IDs → different derived keys
        try alice.deriveSessionKey(peerPublicKeyJwk: bobJwk, sessionId: "session-A")
        try bob.deriveSessionKey(peerPublicKeyJwk: aliceJwk, sessionId: "session-B")

        let encrypted = try alice.encrypt(Data("secret".utf8))
        XCTAssertThrowsError(try bob.decrypt(encrypted))
    }

    // MARK: - Verification Code

    func testVerificationCodeIsNilBeforeKeyDerivation() {
        let crypto = CryptoService()
        XCTAssertNil(crypto.verificationCode())
    }

    func testVerificationCodeIsSixDigits() throws {
        let (alice, _) = try setupPair(sessionId: "verify-format")

        let code = alice.verificationCode()
        XCTAssertNotNil(code)
        XCTAssertEqual(code!.count, 6)

        // All characters are digits
        XCTAssertTrue(code!.allSatisfy { $0.isNumber })
    }

    func testBothPeersGetSameVerificationCode() throws {
        let (alice, bob) = try setupPair(sessionId: "verify-match")

        let aliceCode = alice.verificationCode()
        let bobCode = bob.verificationCode()

        XCTAssertNotNil(aliceCode)
        XCTAssertNotNil(bobCode)
        XCTAssertEqual(aliceCode, bobCode)
    }

    func testDifferentSessionsProduceDifferentVerificationCodes() throws {
        let (alice1, _) = try setupPair(sessionId: "verify-session-A")
        let (alice2, _) = try setupPair(sessionId: "verify-session-B")

        let code1 = alice1.verificationCode()
        let code2 = alice2.verificationCode()

        XCTAssertNotNil(code1)
        XCTAssertNotNil(code2)
        XCTAssertNotEqual(code1, code2)
    }

    func testDifferentKeyPairsProduceDifferentVerificationCodes() throws {
        let (alice1, _) = try setupPair(sessionId: "verify-same-sid")
        let (alice2, _) = try setupPair(sessionId: "verify-same-sid")

        let code1 = alice1.verificationCode()
        let code2 = alice2.verificationCode()

        XCTAssertNotNil(code1)
        XCTAssertNotNil(code2)
        // Different key pairs with the same session ID still yield different codes
        XCTAssertNotEqual(code1, code2)
    }

    func testVerificationCodeIsNilAfterReset() throws {
        let (alice, _) = try setupPair(sessionId: "verify-reset")

        XCTAssertNotNil(alice.verificationCode())
        alice.reset()
        XCTAssertNil(alice.verificationCode())
    }

    // MARK: - Replay Protection

    func testRejectsReplayedFrame() throws {
        let (alice, bob) = try setupPair(sessionId: "sess-replay")

        let plaintext = Data("secret".utf8)
        let encrypted = try alice.encrypt(plaintext)

        // First decrypt succeeds
        XCTAssertEqual(try bob.decrypt(encrypted), plaintext)

        // Replaying the same frame should fail
        XCTAssertThrowsError(try bob.decrypt(encrypted)) { error in
            guard let cryptoError = error as? CryptoService.CryptoError else {
                XCTFail("Expected CryptoError")
                return
            }
            XCTAssertEqual(cryptoError, .replayedFrame)
        }
    }

    func testRejectsOlderCounter() throws {
        let (alice, bob) = try setupPair(sessionId: "sess-old-counter")

        let enc1 = try alice.encrypt(Data("msg1".utf8))
        let enc2 = try alice.encrypt(Data("msg2".utf8))

        // Decrypt frame 2 first (counter 1)
        _ = try bob.decrypt(enc2)

        // Frame 1 (counter 0) should be rejected
        XCTAssertThrowsError(try bob.decrypt(enc1)) { error in
            guard let cryptoError = error as? CryptoService.CryptoError else {
                XCTFail("Expected CryptoError")
                return
            }
            XCTAssertEqual(cryptoError, .replayedFrame)
        }
    }

    func testAcceptsFramesWithCounterGaps() throws {
        let (alice, bob) = try setupPair(sessionId: "sess-gap")

        let enc1 = try alice.encrypt(Data("msg1".utf8))
        _ = try alice.encrypt(Data("msg2".utf8)) // skip this one
        let enc3 = try alice.encrypt(Data("msg3".utf8))

        // Decrypt frame 1
        XCTAssertEqual(try bob.decrypt(enc1), Data("msg1".utf8))

        // Skip frame 2, decrypt frame 3 — should succeed
        XCTAssertEqual(try bob.decrypt(enc3), Data("msg3".utf8))
    }

    func testReplayedFrameErrorDescription() {
        XCTAssertEqual(
            CryptoService.CryptoError.replayedFrame.errorDescription,
            "Replayed or out-of-order frame"
        )
    }

    // MARK: - Error Cases

    func testEncryptWithoutSessionKeyThrows() {
        let crypto = CryptoService()
        _ = crypto.generateKeyPair()

        XCTAssertThrowsError(try crypto.encrypt(Data("test".utf8))) { error in
            guard let cryptoError = error as? CryptoService.CryptoError else {
                XCTFail("Expected CryptoError")
                return
            }
            XCTAssertEqual(cryptoError, .noSessionKey)
        }
    }

    func testDecryptWithoutSessionKeyThrows() {
        let crypto = CryptoService()

        XCTAssertThrowsError(try crypto.decrypt(Data(count: 32))) { error in
            guard let cryptoError = error as? CryptoService.CryptoError else {
                XCTFail("Expected CryptoError")
                return
            }
            XCTAssertEqual(cryptoError, .noSessionKey)
        }
    }

    // MARK: - Reset

    func testResetClearsState() throws {
        let (alice, bob) = try setupPair(sessionId: "sess-reset")

        // Verify it works before reset
        let encrypted = try alice.encrypt(Data("before reset".utf8))
        XCTAssertEqual(try bob.decrypt(encrypted), Data("before reset".utf8))

        alice.reset()
        XCTAssertFalse(alice.isReady)

        // Encrypt should fail after reset
        XCTAssertThrowsError(try alice.encrypt(Data("after reset".utf8)))
    }

    func testResetAndRekeyWorks() throws {
        let alice = CryptoService()
        let bob = CryptoService()

        // First session
        let aliceJwk1 = alice.generateKeyPair()
        let bobJwk1 = bob.generateKeyPair()
        try alice.deriveSessionKey(peerPublicKeyJwk: bobJwk1, sessionId: "s1")
        try bob.deriveSessionKey(peerPublicKeyJwk: aliceJwk1, sessionId: "s1")

        let enc1 = try alice.encrypt(Data("session 1".utf8))
        XCTAssertEqual(try bob.decrypt(enc1), Data("session 1".utf8))

        // Reset and re-key
        alice.reset()
        bob.reset()

        let aliceJwk2 = alice.generateKeyPair()
        let bobJwk2 = bob.generateKeyPair()
        try alice.deriveSessionKey(peerPublicKeyJwk: bobJwk2, sessionId: "s2")
        try bob.deriveSessionKey(peerPublicKeyJwk: aliceJwk2, sessionId: "s2")

        let enc2 = try alice.encrypt(Data("session 2".utf8))
        XCTAssertEqual(try bob.decrypt(enc2), Data("session 2".utf8))
    }

    // MARK: - CryptoError

    func testCryptoErrorDescriptions() {
        XCTAssertEqual(CryptoService.CryptoError.noKeyPair.errorDescription, "No key pair generated")
        XCTAssertEqual(CryptoService.CryptoError.invalidPeerKey.errorDescription, "Invalid peer public key")
        XCTAssertEqual(CryptoService.CryptoError.noSessionKey.errorDescription, "No session key derived")
        XCTAssertEqual(CryptoService.CryptoError.frameTooShort.errorDescription, "Encrypted frame too short")
    }

    // MARK: - Helpers

    /// Sets up two CryptoService instances with a completed key exchange
    private func setupPair(sessionId: String) throws -> (CryptoService, CryptoService) {
        let alice = CryptoService()
        let bob = CryptoService()

        let aliceJwk = alice.generateKeyPair()
        let bobJwk = bob.generateKeyPair()

        try alice.deriveSessionKey(peerPublicKeyJwk: bobJwk, sessionId: sessionId)
        try bob.deriveSessionKey(peerPublicKeyJwk: aliceJwk, sessionId: sessionId)

        return (alice, bob)
    }
}
