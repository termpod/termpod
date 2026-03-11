# Protocol Specification

## Overview

TermPod uses WebSocket for all communication between clients (desktop, mobile) and the relay. The protocol uses two frame types:

- **Binary frames**: Terminal I/O data (high frequency, low overhead)
- **Text frames**: JSON control messages (low frequency, structured)

There are two WebSocket endpoints:

1. **Session WS** (`/sessions/:id/ws`) — Per-session, used by the TerminalSession DO for binary terminal data relay and scrollback. This is the original endpoint.
2. **Device WS** (`/devices/:deviceId/ws`) — Per-device, used by the User DO for session management, control messages, and multiplexed terminal data. This is the primary endpoint for both desktop and mobile.

## Connection Lifecycles

### Session WebSocket (`/sessions/:id/ws`)

Per-session connection to a TerminalSession Durable Object. Handles binary terminal data relay and scrollback buffer.

```
Client                          Relay (Worker → TerminalSession DO)
  │                                        │
  ├─── GET /sessions/:id/ws ──────────────►│
  │    Headers: Authorization: Bearer <token>
  │                                        │
  │◄── 101 Switching Protocols ────────────┤
  │                                        │
  ├─── TEXT: { type: "hello", ... } ──────►│
  │                                        │
  │◄── TEXT: { type: "session_info", ... } ┤
  │◄── TEXT: { type: "ready" } ────────────┤
  │                                        │
  │    ═══ E2E key exchange ═══            │
  │                                        │
  │◄── TEXT: { type: "key_exchange" } ─────┤  (desktop's public key)
  ├─── TEXT: { type: "key_exchange_ack" } ►│  (viewer's public key)
  │                                        │
  │    ═══ encrypted streaming begins ═══  │
  │                                        │
  │◄── BINARY: [0xE0] + encrypted data ────┤  (from desktop PTY, E2E encrypted)
  ├─── BINARY: [0xE0] + encrypted input ──►│  (from mobile keyboard, E2E encrypted)
  │                                        │
```

### Device WebSocket (`/devices/:deviceId/ws`)

Per-device connection to the User Durable Object. Handles session discovery, management, WebRTC signaling, and multiplexed terminal data forwarding.

```
Client                          Relay (Worker → User DO)
  │                                        │
  ├─── GET /devices/:id/ws ───────────────►│
  │    ?token=JWT (or first-message auth)  │
  │                                        │
  │◄── 101 Switching Protocols ────────────┤
  │                                        │
  ├─── TEXT: { type: "auth", token } ─────►│  (if no URL token)
  │◄── TEXT: { type: "auth_ok" } ──────────┤
  │                                        │
  ├─── TEXT: { type: "hello", ... } ──────►│
  │◄── TEXT: { type: "hello_ok", ... } ────┤
  │                                        │
  │    ═══ device control plane active ═══ │
  │                                        │
  ├─── TEXT: { type: "list_sessions" } ───►│  (forwarded to desktop)
  │◄── TEXT: { type: "sessions_list" } ────┤  (from desktop)
  │                                        │
```

## Binary Frame Formats

### Session-Level Binary Frames

Used on Session WS (`/sessions/:id/ws`). All frames start with a 1-byte channel ID:

| Channel | Direction | Description |
|---------|-----------|-------------|
| `0x00` | _(rejected)_ | Plaintext terminal data — no longer accepted on relay; all data must be E2E encrypted |
| `0x01` | desktop → relay | Terminal resize: `[0x01][cols:u16be][rows:u16be]` (non-sensitive metadata) |
| `0x02` | desktop → viewer | Encrypted scrollback chunk (sent via `encrypted_scrollback_chunk` JSON, not binary) |
| `0xE0` | bidirectional | E2E encrypted data: `[0xE0][nonce:12][ciphertext+tag]` |
| `0xE1` | desktop → share viewers | Share-encrypted data: `[0xE1][nonce:12][ciphertext+tag]` |

#### Terminal Data (0x00) — Deprecated on Relay

```
[0x00][raw terminal bytes...]
```

- **No longer accepted on the relay** — all terminal data must be E2E encrypted (`0xE0`)
- Still used on local (Bonjour) transport before E2E key exchange completes (rejected once E2E is active)
- Desktop and iOS never send plaintext `0x00` frames over relay; they drop frames until E2E is established
- Maximum frame size: 64KB (split larger output into multiple frames)

#### Terminal Resize (0x01)

```
[0x01][cols:u16be][rows:u16be]
```

- Sent by desktop when the terminal window is resized
- Relay broadcasts to all viewers so they can adjust their viewport
- Viewers do NOT send resize — they render at the desktop's dimensions

#### Scrollback Chunk (0x02)

```
[0x02][offset:u32be][raw terminal bytes...]
```

- Used inside E2E encrypted scrollback delivery (desktop → viewer after key exchange)
- Desktop buffers scrollback locally and sends it encrypted via `encrypted_scrollback_chunk` JSON messages
- The relay does not store or serve scrollback — it is a pure forwarder of encrypted frames

#### E2E Encrypted Data (0xE0)

```
[0xE0][nonce:12bytes][ciphertext + AES-GCM auth tag]
```

- Used on both relay and local (Bonjour) transports (WebRTC has built-in DTLS)
- Inner plaintext is a standard `[0x00][terminal data]` or `[0x01][resize]` frame
- Nonce is counter-based (8-byte counter, big-endian, zero-padded to 12 bytes)
- Key derived via HKDF-SHA256 from ECDH shared secret, with `termpod-e2e-{sessionId}` as info
- The relay forwards `0xE0` frames without inspecting or modifying the payload
- Key exchange happens via `key_exchange` / `key_exchange_ack` control messages (see below)
- Both peers derive a 6-digit verification code (HKDF with `termpod-verify-{sessionId}` info) for MITM detection

### Multiplexed Binary Frames (Device-Level)

Used on Device WS (`/devices/:deviceId/ws`) and Local WS (Bonjour). Prefixes each frame with a session ID to multiplex multiple sessions over a single connection.

```
[channel:u8][sid_len:u8][sid:utf8][payload:bytes]
```

| Field | Size | Description |
|-------|------|-------------|
| `channel` | 1 byte | Channel ID (0x00, 0x01, 0x02, 0xE0) |
| `sid_len` | 1 byte | Length of session ID string in bytes |
| `sid` | `sid_len` bytes | Session ID (UTF-8 encoded) |
| `payload` | remaining bytes | Channel-specific payload |

#### Multiplexed Terminal Data (0x00)

```
[0x00][sid_len][sid][raw terminal bytes...]
```

#### Multiplexed Terminal Resize (0x01)

```
[0x01][sid_len][sid][cols:u16be][rows:u16be]
```

## Control Messages (JSON Text Frames)

### Session WS Control Messages

These messages are exchanged on the per-session WebSocket (`/sessions/:id/ws`).

#### Client → Relay

##### `hello`

Sent immediately after WebSocket connection is established.

```json
{
  "type": "hello",
  "version": 1,
  "role": "desktop" | "viewer",
  "device": "macos" | "iphone" | "ipad" | "browser",
  "clientId": "uuid-v4"
}
```

##### `input_lock_request`

Optional — request exclusive input rights.

```json
{
  "type": "input_lock_request",
  "clientId": "uuid-v4"
}
```

##### `input_lock_release`

Release exclusive input.

```json
{
  "type": "input_lock_release",
  "clientId": "uuid-v4"
}
```

##### `key_exchange`

Sent by desktop to initiate E2E encryption with a viewer.

```json
{
  "type": "key_exchange",
  "publicKey": { "kty": "EC", "crv": "P-256", "x": "base64url", "y": "base64url" },
  "toClientId": "viewer-uuid"
}
```

##### `key_exchange_ack`

Sent by viewer in response to `key_exchange`. After both sides have exchanged public keys, they derive the shared AES-256-GCM key via HKDF-SHA256.

```json
{
  "type": "key_exchange_ack",
  "publicKey": { "kty": "EC", "crv": "P-256", "x": "base64url", "y": "base64url" },
  "toClientId": "desktop-uuid"
}
```

##### `ping`

Application-level keepalive (in addition to WebSocket protocol pings).

```json
{
  "type": "ping",
  "timestamp": 1709654400000
}
```

#### Relay → Client

##### `session_info`

Sent after `hello` is received. Provides session metadata.

```json
{
  "type": "session_info",
  "sessionId": "session-abc123",
  "name": "",
  "cwd": "",
  "ptySize": { "cols": 120, "rows": 40 },
  "createdAt": "2026-03-05T10:00:00Z",
  "clients": [
    { "clientId": "uuid-1", "role": "desktop", "device": "macos", "connectedAt": "..." },
    { "clientId": "uuid-2", "role": "viewer", "device": "iphone", "connectedAt": "..." }
  ]
}
```

Note: `name` and `cwd` are always empty strings on the relay — real session metadata is delivered E2E encrypted via `encrypted_control` on the Device WS.

##### `ready`

Sent after all scrollback chunks have been delivered.

```json
{
  "type": "ready"
}
```

##### `client_joined` / `client_left`

Broadcast when clients connect to or disconnect from the session.

```json
{
  "type": "client_joined",
  "clientId": "uuid-v4",
  "role": "viewer",
  "device": "iphone"
}
```

```json
{
  "type": "client_left",
  "clientId": "uuid-v4",
  "reason": "closed" | "timeout" | "error"
}
```

##### `pty_resize`

Broadcast when the desktop resizes the terminal (echoed from binary 0x01).

```json
{
  "type": "pty_resize",
  "cols": 120,
  "rows": 40
}
```

##### `input_lock_granted` / `input_lock_denied`

```json
{
  "type": "input_lock_granted",
  "clientId": "uuid-v4"
}
```

```json
{
  "type": "input_lock_denied",
  "reason": "Another client holds the lock",
  "holder": "uuid-other"
}
```

##### `session_ended`

Sent when the desktop PTY exits or the desktop disconnects.

```json
{
  "type": "session_ended",
  "reason": "pty_exit" | "desktop_disconnected",
  "exitCode": 0
}
```

##### `pong`

```json
{
  "type": "pong",
  "timestamp": 1709654400000,
  "serverTime": 1709654400005
}
```

##### `error`

```json
{
  "type": "error",
  "code": "AUTH_FAILED" | "SESSION_NOT_FOUND" | "RATE_LIMITED" | "INTERNAL",
  "message": "Human-readable description"
}
```

### Device WS Control Messages

These messages are exchanged on the per-device WebSocket (`/devices/:deviceId/ws`). The User DO forwards messages between desktop and mobile clients connected to the same account.

#### Authentication

##### `auth`

Sent as the first message if no JWT was provided in the URL query.

```json
{
  "type": "auth",
  "token": "JWT_ACCESS_TOKEN"
}
```

##### `auth_ok`

Confirms successful authentication.

```json
{
  "type": "auth_ok"
}
```

#### Handshake

##### `hello` (device)

```json
{
  "type": "hello",
  "role": "desktop" | "viewer",
  "device": "macos" | "iphone" | "ipad",
  "clientId": "uuid-v4",
  "version": 1
}
```

##### `hello_ok`

```json
{
  "type": "hello_ok",
  "clients": [
    { "clientId": "uuid", "role": "desktop", "device": "macos", "connectedAt": "ISO-8601" }
  ]
}
```

#### Session Management

These are forwarded between desktop and mobile clients by the User DO.

##### `list_sessions`

```json
{ "type": "list_sessions" }
```

##### `sessions_list`

```json
{
  "type": "sessions_list",
  "sessions": [
    {
      "id": "uuid",
      "ptyCols": 120,
      "ptyRows": 40,
      "createdAt": "ISO-8601"
    }
  ]
}
```

Note: The relay only returns non-sensitive fields (ID, dimensions, timestamps). Session metadata (name, cwd, processName) is delivered E2E encrypted via `encrypted_control`.

##### `sessions_updated`

Sent by desktop when the session list changes. Contains only non-sensitive fields (IDs, dimensions). The User DO persists these to SQLite. Real session metadata is sent separately via `encrypted_control`.

##### `create_session_request`

```json
{
  "type": "create_session_request",
  "requestId": "uuid"
}
```

##### `session_created`

Sent E2E encrypted via `encrypted_control` — the relay forwards the opaque ciphertext without reading it.

```json
{
  "type": "session_created",
  "requestId": "uuid",
  "sessionId": "new-session-uuid",
  "name": "project-name",
  "cwd": "/path",
  "ptyCols": 120,
  "ptyRows": 40
}
```

##### `delete_session`

```json
{
  "type": "delete_session",
  "sessionId": "uuid"
}
```

##### `session_closed`

```json
{
  "type": "session_closed",
  "sessionId": "uuid"
}
```

#### Client Presence

##### `client_joined` / `client_left`

Broadcast by the User DO when clients connect to or disconnect from the device WS.

```json
{
  "type": "client_joined",
  "clientId": "uuid",
  "role": "desktop" | "viewer",
  "device": "macos" | "iphone" | "ipad"
}
```

```json
{
  "type": "client_left",
  "clientId": "uuid",
  "role": "desktop" | "viewer",
  "device": "macos"
}
```

#### E2E Key Exchange

##### `key_exchange`

Sent by desktop to a viewer via Device WS to initiate E2E encryption for relay transport.

```json
{
  "type": "key_exchange",
  "publicKey": { "kty": "EC", "crv": "P-256", "x": "base64url", "y": "base64url" },
  "toClientId": "viewer-uuid"
}
```

##### `key_exchange_ack`

Sent by viewer in response.

```json
{
  "type": "key_exchange_ack",
  "publicKey": { "kty": "EC", "crv": "P-256", "x": "base64url", "y": "base64url" },
  "toClientId": "desktop-uuid"
}
```

The User DO forwards these messages between clients without inspecting them.

#### Local Auth

##### `local_auth_secret`

Sent by desktop to mobile viewers via Device WS, wrapped in `encrypted_control` (E2E encrypted — the relay cannot read it). Contains the auth secret required to connect to the desktop's local Bonjour WebSocket server.

```json
{
  "type": "local_auth_secret",
  "secret": "random-auth-secret"
}
```

#### WebRTC Signaling

WebRTC signaling is routed through the Device WS (User DO) with a `toClientId` field for peer targeting.

##### `webrtc_offer`

```json
{
  "type": "webrtc_offer",
  "toClientId": "target-uuid",
  "from": "source-uuid",
  "offer": { "type": "offer", "sdp": "v=0\r\no=- ..." }
}
```

##### `webrtc_answer`

```json
{
  "type": "webrtc_answer",
  "toClientId": "target-uuid",
  "from": "source-uuid",
  "answer": { "type": "answer", "sdp": "v=0\r\no=- ..." }
}
```

##### `webrtc_ice`

```json
{
  "type": "webrtc_ice",
  "toClientId": "target-uuid",
  "from": "source-uuid",
  "candidate": { "candidate": "candidate:...", "sdpMLineIndex": 0 }
}
```

ICE servers: Google STUN (`stun:stun.l.google.com:19302`, `stun:stun1.l.google.com:19302`) and Cloudflare STUN (`stun:stun.cloudflare.com:3478`). Optional Cloudflare TURN credentials are fetched from `GET /turn-credentials` (authenticated) before each WebRTC connection attempt. If TURN is not configured on the relay, clients fall back to STUN-only with the relay WebSocket as the final fallback transport.

### Local WS Control Messages (Bonjour P2P)

These messages are sent over the direct local WebSocket for session subscription management.

#### `auth`

Must be the **first message** sent on the local WebSocket. The desktop validates the secret before accepting any other messages.

```json
{
  "type": "auth",
  "secret": "random-auth-secret"
}
```

The secret is obtained from the desktop via the `local_auth_secret` Device WS message (see above). If the secret is invalid, the desktop closes the connection.

#### `subscribe_session`

Sent by mobile to start receiving multiplexed binary data for a session.

```json
{
  "type": "subscribe_session",
  "sessionId": "uuid"
}
```

#### `unsubscribe_session`

```json
{
  "type": "unsubscribe_session",
  "sessionId": "uuid"
}
```

Session management messages (`list_sessions`, `sessions_list`, `create_session_request`, `delete_session`, `session_closed`) also work over the local WS.

## REST API (Worker)

### Auth Endpoints (Public)

#### `POST /auth/signup`

```
Content-Type: application/json

{ "email": "user@example.com", "password": "secret" }

→ 200 OK
{ "accessToken": "JWT", "refreshToken": "JWT" }
```

#### `POST /auth/login`

Same request/response as signup.

#### `POST /auth/refresh`

```
Content-Type: application/json

{ "refreshToken": "JWT" }

→ 200 OK
{ "accessToken": "JWT", "refreshToken": "JWT" }
```

### Device Endpoints (Authenticated)

#### `GET /devices`

List all devices registered to the authenticated user.

#### `POST /devices`

Register a new device.

#### `DELETE /devices/:deviceId`

Remove a device.

#### `POST /devices/:deviceId/heartbeat`

Device keepalive.

#### `POST /devices/:deviceId/offline`

Mark device as offline.

### Session Endpoints (Authenticated)

#### `GET /devices/:deviceId/sessions`

List sessions for a device.

#### `POST /devices/:deviceId/sessions`

Register a new session on a device.

#### `DELETE /sessions/:sessionId`

Delete a session.

#### `PATCH /sessions/:sessionId`

No-op — session metadata is now delivered E2E encrypted via Device WS. This endpoint exists for backward compatibility but does not update any fields.

### WebSocket Endpoints (Authenticated)

#### `GET /devices/:deviceId/ws`

Device-level WebSocket. Auth via `?token=JWT` query param or first-message `auth` JSON.

#### `GET /sessions/:sessionId/ws`

Session-level WebSocket. Auth via `Authorization: Bearer <token>` header or `?token=JWT`.

### Auto-Update Proxy (Public)

#### `GET /updates/latest.json`

Returns latest release metadata from GitHub. Download URLs are rewritten to proxy through the relay (for private repos).

#### `GET /updates/download/:filename`

Proxies release artifact downloads from GitHub.

### TURN Credentials (Authenticated)

#### `GET /turn-credentials`

Returns ICE server configuration including TURN credentials (if configured on the relay). Used by both desktop and mobile before establishing WebRTC connections.

```
Authorization: Bearer <token>

→ 200 OK
{ "iceServers": [{ "urls": ["turn:..."], "username": "...", "credential": "..." }] }

→ 503 Service Unavailable (if TURN not configured)
{ "error": "TURN not configured" }
```

## Transport Priority

TermPod uses three transports in order of preference:

1. **Local WebSocket (Bonjour)** — Same LAN, ~1-5ms. Desktop advertises `_termpod._tcp` via mDNS. Single multiplexed connection per device.
2. **WebRTC DataChannel** — Different networks, ~10-30ms. STUN/TURN-based P2P. Signaling routed through Device WS.
3. **Relay Device WS** — Fallback, ~30-80ms. Always connected for signaling, session management, and as fallback data path.

All transports use the same multiplexed binary frame format (`[channel][sid_len][sid][payload]`). The mobile app receives data from ALL connected transports but sends only through the best available one (priority order above).

## Versioning

The `version` field in the `hello` message enables protocol evolution. The relay should:

1. Accept the client's version
2. Respond with the highest mutually supported version
3. Reject connections with unsupported versions

Current version: `1`
