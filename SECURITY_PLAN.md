# Security Plan: JWT Auth for Local + E2E Encryption for Relay

## Status: Implemented

## Context

TermPod has three transport layers:
1. **Local (Bonjour WS)** — fastest (~1ms), no auth currently
2. **WebRTC P2P** — E2E encrypted by design (DTLS), works over LAN and internet (STUN/TURN)
3. **Relay (CF Workers/DO)** — most reliable fallback, terminal data visible to relay

### Why keep all three transports?

WebRTC with STUN/TURN *could* theoretically replace both local and relay, but:

- **Bonjour is faster**: ~1ms latency, instant connection vs WebRTC's 1-5s ICE negotiation. For terminal responsiveness, this matters.
- **TURN costs money**: When STUN fails (symmetric NATs, corporate firewalls), TURN relays all data through Cloudflare's servers at metered bandwidth rates. The relay DO is much cheaper for terminal-sized payloads.
- **WebRTC can be flaky**: ICE restarts, candidate gathering timeouts, DTLS renegotiation. A plain WebSocket is rock solid.
- **Relay is the universal fallback**: Some networks block UDP entirely (WebRTC needs UDP). The relay WS works everywhere.
- **Signaling still needs a server**: WebRTC can't connect without SDP/ICE exchange — the relay handles this regardless.

Each transport covers failure modes the others can't. Same pattern as AirDrop (local) + FaceTime (P2P) + iMessage (relay).

---

## Part 1: JWT Auth on Local Bonjour Transport

### Problem

`local_server.rs` accepts any LAN connection with zero authentication. On shared/office WiFi, anyone can discover and connect.

### Design

Desktop generates a **local pairing secret** on startup. This secret is shared with authenticated iOS devices via the relay device WS (already authenticated), then required on local WS connections.

### Flow

```
Desktop starts → generates random 32-byte hex secret
Desktop → Relay Device WS → iOS: {"type": "local_auth_secret", "secret": "..."}
iOS stores secret
iOS discovers desktop via Bonjour
iOS → Local WS first message: {"type": "auth", "secret": "..."}
Desktop validates → allows connection OR closes with 4001
```

### Changes

#### `apps/desktop/src-tauri/src/local_server.rs`
- Add `local_auth_secret: String` to server state (generated via `rand`)
- After WS upgrade, expect first message `{"type": "auth", "secret": "..."}`
- Validate before allowing `hello` and subsequent messages
- Close with code 4001 on mismatch

#### `apps/desktop/src/hooks/useLocalServer.ts`
- Expose `localAuthSecret` from Tauri command
- Pass to device WS hook for sharing

#### `apps/desktop/src/hooks/useDeviceWS.ts`
- Send `{"type": "local_auth_secret", "secret": "..."}` to connected viewers
- Broadcast to new viewer connections

#### `relay/src/user.ts` (User DO)
- Forward `local_auth_secret` message type (desktop → viewers only)
- No storage, just relay

#### `apps/ios/TermPod/Networking/DeviceTransportManager.swift`
- Store `localAuthSecret` received from device WS
- On local WS connect, send auth message before hello
- If no secret available, skip local connection (graceful fallback)

---

## Part 2: E2E Encryption for Relay Transport

### Problem

The TerminalSession DO sees all terminal data in plaintext. Users must trust the relay operator.

### Design

ECDH key exchange + AES-256-GCM encryption on relay transport. The relay only routes opaque ciphertext.

### Key Exchange Protocol

```
┌─────────┐         ┌───────┐         ┌─────────┐
│ Desktop │         │ Relay │         │   iOS   │
└────┬────┘         └───┬───┘         └────┬────┘
     │  key_exchange    │                   │
     │  {ephemeralPub}  │  key_exchange     │
     │─────────────────>│──────────────────>│
     │                  │                   │
     │  key_exchange_ack│  key_exchange_ack  │
     │  {ephemeralPub}  │  {ephemeralPub}   │
     │<─────────────────│<──────────────────│
     │                  │                   │
     │     Both derive shared secret via ECDH + HKDF
     │     Encrypt all live terminal data from here on
```

### Crypto Details

- **Key Agreement:** ECDH P-256 (Web Crypto `crypto.subtle` on desktop, `CryptoKit` on iOS)
- **KDF:** HKDF-SHA256, `info = "termpod-e2e-" + sessionId`
- **Cipher:** AES-256-GCM (hardware-accelerated on all platforms)
- **Nonce:** 96-bit counter-based (separate send/receive counters per direction)
- **AAD:** `sessionId` bytes (prevents cross-session replay)

### Encrypted Frame Format

```
Original frame:   [channel][payload...]
Encrypted frame:  [0xE0][nonce:12bytes][ciphertext+tag...]

0xE0 = encrypted wrapper channel
Relay sees 0xE0 → forwards blindly
After decryption → original [channel][payload...] frame
```

### Scrollback Handling

Live data (channels 0x00, 0x01) is encrypted. Scrollback (channel 0x02) remains plaintext for v1.

Rationale: Encrypting scrollback requires key persistence across reconnects, adding significant complexity. Scrollback is a convenience feature — live data encryption is the priority. Encrypted scrollback can be added in a future iteration.

### Changes

#### `packages/protocol/src/binary.ts`
- Add `ENCRYPTED: 0xE0` channel constant
- Add `encodeEncryptedFrame(nonce, ciphertext)` and `decodeEncryptedFrame(frame)` functions

#### `packages/protocol/src/crypto.ts` (NEW)
```typescript
// Web Crypto API — works in browser, Node, CF Workers
generateKeyPair(): Promise<{ publicKey: JsonWebKey, privateKey: CryptoKey }>
deriveSharedSecret(privateKey, peerPublicKey, sessionId): Promise<CryptoKey>
encryptFrame(key, counter, sessionId, plaintext): Promise<Uint8Array>
decryptFrame(key, sessionId, nonce, ciphertext): Promise<Uint8Array>
```

#### `apps/desktop/src/hooks/useRelayConnection.ts`
- Generate ephemeral ECDH key pair on connect
- Send `{"type": "key_exchange", "publicKey": jwk}` after auth
- On `key_exchange_ack`, derive session key
- Wrap outgoing binary frames: `plainFrame → encryptFrame() → 0xE0 frame`
- Unwrap incoming: `0xE0 frame → decryptFrame() → process`
- Maintain send/receive nonce counters

#### `apps/ios/TermPod/Services/CryptoService.swift` (NEW)
```swift
import CryptoKit

class CryptoService {
    func generateKeyPair() -> (privateKey: P256.KeyAgreement.PrivateKey, publicKey: Data)
    func deriveSessionKey(peerPublicKey: Data, sessionId: String)
    func encrypt(_ data: Data) throws -> Data      // nonce + ciphertext
    func decrypt(_ encrypted: Data) throws -> Data  // strips nonce, decrypts
}
```

#### `apps/ios/TermPod/Networking/RelayClient.swift`
- On `key_exchange` from desktop, generate own key pair, respond with `key_exchange_ack`
- Derive shared session key via CryptoService
- Encrypt outgoing input, decrypt incoming data

#### `relay/src/session.ts` (TerminalSession DO)
- Forward `0xE0` frames as-is (same as current binary relay logic)
- Forward `key_exchange` / `key_exchange_ack` JSON messages
- Store encrypted frames in scrollback buffer (opaque blobs)

#### `relay/src/user.ts` (User DO)
- Forward `key_exchange` / `key_exchange_ack` on device WS

---

## Implementation Order

| Phase | What | Files | Effort |
|-------|------|-------|--------|
| 1 | Protocol crypto module | `packages/protocol/src/crypto.ts`, `binary.ts` | Small |
| 2 | Desktop relay E2E | `useRelayConnection.ts` | Medium |
| 3 | iOS CryptoService | `CryptoService.swift` | Medium |
| 4 | iOS relay E2E | `RelayClient.swift` | Medium |
| 5 | Relay forwarding updates | `session.ts`, `user.ts` | Small |
| 6 | Local auth secret (Rust) | `local_server.rs` | Medium |
| 7 | Local auth secret sharing | `useDeviceWS.ts`, `useLocalServer.ts` | Small |
| 8 | iOS local auth | `DeviceTransportManager.swift` | Small |

Phases 1-5 (relay E2E) and 6-8 (local auth) are independent — can be developed in parallel.

---

## Security Properties

| Property | Local (after auth) | WebRTC | Relay (after E2E) |
|----------|-------------------|--------|-------------------|
| Authentication | Pairing secret via relay | Signaling auth | JWT |
| Encryption in transit | No (plain WS on LAN) | DTLS (built-in) | TLS + AES-256-GCM E2E |
| Relay can read data | N/A | N/A | No (encrypted) |
| Forward secrecy | N/A | Yes (DTLS) | Yes (ephemeral ECDH) |
| Replay protection | N/A | DTLS | Counter nonces + AAD |

### Known Limitations (v1)

- **Local WS is unencrypted** (ws:// not wss://). TLS on local server requires certificate management — future enhancement.
- **Scrollback on relay is plaintext**. Encrypted scrollback requires key persistence across reconnects.
- **Key exchange is relay-mediated**. A compromised relay could theoretically MITM the ECDH exchange. Mitigation: out-of-band key verification (like Signal safety numbers) in a future version. For v1, acceptable since relay is self-hostable.
- **mDNS service is still discoverable**. Authenticated connections will be rejected, but the service is visible on the network.
