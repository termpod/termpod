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
  │◄── BINARY: [0x00] + scrollback data ──┤
  │◄── TEXT: { type: "ready" } ───────────┤
  │                                        │
  │    ═══ real-time streaming begins ═══  │
  │                                        │
  │◄── BINARY: [0x00] + terminal output ──┤  (from desktop PTY)
  ├─── BINARY: [0x00] + terminal input ──►│  (from mobile keyboard)
  │                                        │
```

### Device WebSocket (`/devices/:deviceId/ws`)

Per-device connection to the User Durable Object. Handles session discovery, management, WebRTC signaling, and multiplexed terminal data forwarding.

```
Client                          Relay (Worker → User DO)
  │                                        │
  ├─── GET /devices/:id/ws ──────────────►│
  │    ?token=JWT (or first-message auth)  │
  │                                        │
  │◄── 101 Switching Protocols ────────────┤
  │                                        │
  ├─── TEXT: { type: "auth", token } ─────►│  (if no URL token)
  │◄── TEXT: { type: "auth_ok" } ─────────┤
  │                                        │
  ├─── TEXT: { type: "hello", ... } ──────►│
  │◄── TEXT: { type: "hello_ok", ... } ───┤
  │                                        │
  │    ═══ device control plane active ═══ │
  │                                        │
  ├─── TEXT: { type: "list_sessions" } ───►│  (forwarded to desktop)
  │◄── TEXT: { type: "sessions_list" } ───┤  (from desktop)
  │                                        │
```

## Binary Frame Formats

### Session-Level Binary Frames

Used on Session WS (`/sessions/:id/ws`). All frames start with a 1-byte channel ID:

| Channel | Direction | Description |
|---------|-----------|-------------|
| `0x00` | bidirectional | Terminal data (stdout from desktop, stdin from viewers) |
| `0x01` | desktop → relay | Terminal resize: `[0x01][cols:u16be][rows:u16be]` |
| `0x02` | relay → viewer | Scrollback chunk: `[0x02][offset:u32be][data...]` |

#### Terminal Data (0x00)

```
[0x00][raw terminal bytes...]
```

- From desktop: PTY stdout (ANSI escape codes, UTF-8 text, binary data)
- From viewer: keyboard input to forward to PTY stdin
- No length prefix — WebSocket framing handles message boundaries
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

- Sent by relay to a newly connected viewer
- `offset` is the byte position in the session's total output history
- May be sent in multiple chunks if scrollback is large
- After all scrollback is sent, relay sends a `ready` control message

### Multiplexed Binary Frames (Device-Level)

Used on Device WS (`/devices/:deviceId/ws`) and Local WS (Bonjour). Prefixes each frame with a session ID to multiplex multiple sessions over a single connection.

```
[channel:u8][sid_len:u8][sid:utf8][payload:bytes]
```

| Field | Size | Description |
|-------|------|-------------|
| `channel` | 1 byte | Channel ID (0x00, 0x01, 0x02) |
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
  "name": "termpod/apps/desktop",
  "cwd": "/Users/dev/code/termpod/apps/desktop",
  "ptySize": { "cols": 120, "rows": 40 },
  "createdAt": "2026-03-05T10:00:00Z",
  "clients": [
    { "clientId": "uuid-1", "role": "desktop", "device": "macos", "connectedAt": "..." },
    { "clientId": "uuid-2", "role": "viewer", "device": "iphone", "connectedAt": "..." }
  ]
}
```

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
      "name": "my-project",
      "cwd": "/path",
      "processName": "claude",
      "ptyCols": 120,
      "ptyRows": 40,
      "createdAt": "ISO-8601"
    }
  ]
}
```

##### `sessions_updated`

Broadcast by desktop when the session list changes (same structure as `sessions_list`). The User DO also persists this to SQLite for offline device queries.

##### `create_session_request`

```json
{
  "type": "create_session_request",
  "requestId": "uuid"
}
```

##### `session_created`

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

STUN servers: Google (`stun:stun.l.google.com:19302`) and Cloudflare (`stun:stun.cloudflare.com:3478`). No TURN — the relay WebSocket is the fallback transport.

### Local WS Control Messages (Bonjour P2P)

These messages are sent over the direct local WebSocket for session subscription management.

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

Update session metadata (name, cwd, processName).

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

## Transport Priority

TermPod uses three transports in order of preference:

1. **Local WebSocket (Bonjour)** — Same LAN, ~1-5ms. Desktop advertises `_termpod._tcp` via mDNS. Single multiplexed connection per device.
2. **WebRTC DataChannel** — Different networks, ~10-30ms. STUN-based P2P. Signaling routed through Device WS.
3. **Relay Device WS** — Fallback, ~30-80ms. Always connected for signaling, session management, and as fallback data path.

All transports use the same multiplexed binary frame format (`[channel][sid_len][sid][payload]`). The mobile app receives data from ALL connected transports but sends only through the best available one (priority order above).

## Versioning

The `version` field in the `hello` message enables protocol evolution. The relay should:

1. Accept the client's version
2. Respond with the highest mutually supported version
3. Reject connections with unsupported versions

Current version: `1`
