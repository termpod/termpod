import Foundation
import CryptoKit

class CryptoService {
    private var privateKey: P256.KeyAgreement.PrivateKey?
    private var sessionKey: SymmetricKey?
    private var sendCounter: UInt64 = 0
    private var recvCounter: UInt64 = 0
    private var sessionId: String = ""
    private var storedVerificationCode: String?

    /// Generate a new ECDH key pair and return the public key as a JWK-compatible dictionary
    func generateKeyPair() -> [String: Any] {
        let key = P256.KeyAgreement.PrivateKey()
        self.privateKey = key

        let publicKey = key.publicKey
        let x963 = publicKey.x963Representation
        // x963 format: [0x04][x:32bytes][y:32bytes]
        let xData = x963[1..<33]
        let yData = x963[33..<65]

        return [
            "kty": "EC",
            "crv": "P-256",
            "x": base64urlEncode(Data(xData)),
            "y": base64urlEncode(Data(yData))
        ]
    }

    /// Derive the shared session key from the peer's JWK public key
    func deriveSessionKey(peerPublicKeyJwk: [String: Any], sessionId: String) throws {
        guard let privateKey = self.privateKey else {
            throw CryptoError.noKeyPair
        }

        guard let xStr = peerPublicKeyJwk["x"] as? String,
              let yStr = peerPublicKeyJwk["y"] as? String,
              let xData = base64urlDecode(xStr),
              let yData = base64urlDecode(yStr) else {
            throw CryptoError.invalidPeerKey
        }

        // Reconstruct x963 representation: [0x04][x][y]
        var x963 = Data([0x04])
        x963.append(xData)
        x963.append(yData)

        let peerPublicKey = try P256.KeyAgreement.PublicKey(x963Representation: x963)
        let sharedSecret = try privateKey.sharedSecretFromKeyAgreement(with: peerPublicKey)

        // Derive AES-256 key using HKDF with session ID as info
        let info = "termpod-e2e-\(sessionId)"
        let derivedKey = sharedSecret.hkdfDerivedSymmetricKey(
            using: SHA256.self,
            salt: Data(count: 32), // Zero salt — ECDH output is already high-entropy
            sharedInfo: Data(info.utf8),
            outputByteCount: 32
        )

        // Derive verification code from shared secret (separate HKDF info)
        let verifyInfo = "termpod-verify-\(sessionId)"
        let verifyKey = sharedSecret.hkdfDerivedSymmetricKey(
            using: SHA256.self,
            salt: Data(count: 32),
            sharedInfo: Data(verifyInfo.utf8),
            outputByteCount: 8
        )
        let verifyBytes = verifyKey.withUnsafeBytes { Array($0) }
        let verifyNum = UInt32(verifyBytes[0]) << 24 | UInt32(verifyBytes[1]) << 16 | UInt32(verifyBytes[2]) << 8 | UInt32(verifyBytes[3])
        self.storedVerificationCode = String(format: "%06d", verifyNum % 1_000_000)

        self.sessionKey = derivedKey
        self.sessionId = sessionId
        self.sendCounter = 0
        self.recvCounter = 0
    }

    var isReady: Bool {
        sessionKey != nil
    }

    /// Encrypt a frame. Returns [nonce:12][ciphertext+tag]
    func encrypt(_ plaintext: Data) throws -> Data {
        guard let key = sessionKey else {
            throw CryptoError.noSessionKey
        }

        let nonce = counterToNonce(sendCounter)
        sendCounter += 1

        let aad = Data(sessionId.utf8)
        let sealedBox = try AES.GCM.seal(
            plaintext,
            using: key,
            nonce: AES.GCM.Nonce(data: nonce),
            authenticating: aad
        )

        // [nonce:12][ciphertext+tag]
        var result = Data(nonce)
        result.append(sealedBox.ciphertext)
        result.append(sealedBox.tag)

        return result
    }

    /// Decrypt a frame. Input is [nonce:12][ciphertext+tag]
    func decrypt(_ encrypted: Data) throws -> Data {
        guard let key = sessionKey else {
            throw CryptoError.noSessionKey
        }

        guard encrypted.count >= 12 + 16 else {
            throw CryptoError.frameTooShort
        }

        let nonce = encrypted[encrypted.startIndex..<encrypted.startIndex + 12]
        let ciphertextAndTag = encrypted[(encrypted.startIndex + 12)...]
        let tagStart = ciphertextAndTag.endIndex - 16
        let ciphertext = ciphertextAndTag[ciphertextAndTag.startIndex..<tagStart]
        let tag = ciphertextAndTag[tagStart...]

        // Validate nonce matches expected counter (replay protection)
        let receivedCounter = nonceToCounter(nonce)

        if receivedCounter < recvCounter {
            throw CryptoError.replayedFrame
        }

        let aad = Data(sessionId.utf8)
        let sealedBox = try AES.GCM.SealedBox(
            nonce: AES.GCM.Nonce(data: nonce),
            ciphertext: ciphertext,
            tag: tag
        )

        let plaintext = try AES.GCM.open(sealedBox, using: key, authenticating: aad)
        recvCounter = receivedCounter + 1

        return plaintext
    }

    /// 6-digit verification code derived from the shared secret.
    /// Both peers should display the same code — mismatch indicates MITM.
    func verificationCode() -> String? {
        storedVerificationCode
    }

    /// Reset all state (for reconnection)
    func reset() {
        privateKey = nil
        sessionKey = nil
        sendCounter = 0
        recvCounter = 0
        sessionId = ""
        storedVerificationCode = nil
    }

    // MARK: - Helpers

    private func nonceToCounter(_ nonce: Data) -> UInt64 {
        let high = UInt64(nonce[4]) << 24 | UInt64(nonce[5]) << 16 | UInt64(nonce[6]) << 8 | UInt64(nonce[7])
        let low = UInt64(nonce[8]) << 24 | UInt64(nonce[9]) << 16 | UInt64(nonce[10]) << 8 | UInt64(nonce[11])

        return high << 32 | low
    }

    private func counterToNonce(_ counter: UInt64) -> Data {
        var nonce = Data(count: 12)
        // Store counter in last 8 bytes (big-endian), first 4 bytes zero
        let high = UInt32((counter >> 32) & 0xFFFFFFFF)
        let low = UInt32(counter & 0xFFFFFFFF)
        nonce[4] = UInt8((high >> 24) & 0xFF)
        nonce[5] = UInt8((high >> 16) & 0xFF)
        nonce[6] = UInt8((high >> 8) & 0xFF)
        nonce[7] = UInt8(high & 0xFF)
        nonce[8] = UInt8((low >> 24) & 0xFF)
        nonce[9] = UInt8((low >> 16) & 0xFF)
        nonce[10] = UInt8((low >> 8) & 0xFF)
        nonce[11] = UInt8(low & 0xFF)
        return nonce
    }

    private func base64urlEncode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    private func base64urlDecode(_ string: String) -> Data? {
        var base64 = string
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        // Add padding
        let remainder = base64.count % 4
        if remainder > 0 {
            base64.append(String(repeating: "=", count: 4 - remainder))
        }
        return Data(base64Encoded: base64)
    }

    enum CryptoError: Error, LocalizedError, Equatable {
        case noKeyPair
        case invalidPeerKey
        case noSessionKey
        case frameTooShort
        case replayedFrame

        var errorDescription: String? {
            switch self {
            case .noKeyPair: return "No key pair generated"
            case .invalidPeerKey: return "Invalid peer public key"
            case .noSessionKey: return "No session key derived"
            case .frameTooShort: return "Encrypted frame too short"
            case .replayedFrame: return "Replayed or out-of-order frame"
            }
        }
    }
}
