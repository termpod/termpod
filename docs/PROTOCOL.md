# Protocol Specification

## Overview

Termpod uses WebSocket for all communication between clients (desktop, mobile) and the relay. The protocol uses two frame types:

- **Binary frames**: Terminal I/O data (high frequency, low overhead)
- **Text frames**: JSON control messages (low frequency, structured)

## Connection Lifecycle

```
Client                          Relay (Worker → Durable Object)
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

## Binary Frame Format

All binary frames start with a 1-byte channel ID:

| Channel | Direction | Description |
|---------|-----------|-------------|
| `0x00` | bidirectional | Terminal data (stdout from desktop, stdin from viewers) |
| `0x01` | desktop → relay | Terminal resize: `[0x01][cols:u16be][rows:u16be]` |
| `0x02` | relay → viewer | Scrollback chunk: `[0x02][offset:u32be][data...]` |

### Terminal Data (0x00)

```
[0x00][raw terminal bytes...]
```

- From desktop: PTY stdout (ANSI escape codes, UTF-8 text, binary data)
- From viewer: keyboard input to forward to PTY stdin
- No length prefix — WebSocket framing handles message boundaries
- Maximum frame size: 64KB (split larger output into multiple frames)

### Terminal Resize (0x01)

```
[0x01][cols:u16be][rows:u16be]
```

- Sent by desktop when the terminal window is resized
- Relay broadcasts to all viewers so they can adjust their xterm.js viewport
- Viewers do NOT send resize — they render at the desktop's dimensions

### Scrollback Chunk (0x02)

```
[0x02][offset:u32be][raw terminal bytes...]
```

- Sent by relay to a newly connected viewer
- `offset` is the byte position in the session's total output history
- May be sent in multiple chunks if scrollback is large
- After all scrollback is sent, relay sends a `ready` control message

## Control Messages (JSON Text Frames)

### Client → Relay

#### `hello`

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

#### `input_lock_request`

Optional — request exclusive input rights.

```json
{
  "type": "input_lock_request",
  "clientId": "uuid-v4"
}
```

#### `input_lock_release`

Release exclusive input.

```json
{
  "type": "input_lock_release",
  "clientId": "uuid-v4"
}
```

#### `ping`

Application-level keepalive (in addition to WebSocket protocol pings).

```json
{
  "type": "ping",
  "timestamp": 1709654400000
}
```

### Relay → Client

#### `session_info`

Sent after `hello` is received. Provides session metadata.

```json
{
  "type": "session_info",
  "sessionId": "session-abc123",
  "name": "termpod/apps/desktop",
  "cwd": "/Users/swapnil/code/termpod/apps/desktop",
  "ptySize": { "cols": 120, "rows": 40 },
  "createdAt": "2026-03-05T10:00:00Z",
  "clients": [
    { "clientId": "uuid-1", "role": "desktop", "device": "macos", "connectedAt": "..." },
    { "clientId": "uuid-2", "role": "viewer", "device": "iphone", "connectedAt": "..." }
  ]
}
```

#### `ready`

Sent after all scrollback chunks have been delivered. Signals that the client should switch from "loading" to "live" state.

```json
{
  "type": "ready"
}
```

#### `client_joined`

Broadcast when a new client connects to the session.

```json
{
  "type": "client_joined",
  "clientId": "uuid-v4",
  "role": "viewer",
  "device": "iphone"
}
```

#### `client_left`

Broadcast when a client disconnects.

```json
{
  "type": "client_left",
  "clientId": "uuid-v4",
  "reason": "closed" | "timeout" | "error"
}
```

#### `pty_resize`

Broadcast when the desktop resizes the terminal (echoed from binary 0x01).

```json
{
  "type": "pty_resize",
  "cols": 120,
  "rows": 40
}
```

#### `input_lock_granted`

```json
{
  "type": "input_lock_granted",
  "clientId": "uuid-v4"
}
```

#### `input_lock_denied`

```json
{
  "type": "input_lock_denied",
  "reason": "Another client holds the lock",
  "holder": "uuid-other"
}
```

#### `session_ended`

Sent when the desktop PTY exits or the desktop disconnects.

```json
{
  "type": "session_ended",
  "reason": "pty_exit" | "desktop_disconnected",
  "exitCode": 0
}
```

#### `pong`

Response to client ping.

```json
{
  "type": "pong",
  "timestamp": 1709654400000,
  "serverTime": 1709654400005
}
```

#### `error`

```json
{
  "type": "error",
  "code": "AUTH_FAILED" | "SESSION_NOT_FOUND" | "RATE_LIMITED" | "INTERNAL",
  "message": "Human-readable description"
}
```

## REST API (Worker)

### `POST /sessions`

Create a new session. Called by the desktop app.

```
Authorization: Bearer <user-token>
Content-Type: application/json

{
  "name": "my-project",
  "ptySize": { "cols": 120, "rows": 40 }
}

→ 201 Created
{
  "sessionId": "session-abc123",
  "token": "pair-token-xyz789",
  "tokenExpiresAt": "2026-03-05T10:05:00Z",
  "wsUrl": "wss://relay.termpod.dev/sessions/session-abc123/ws"
}
```

### `GET /sessions`

List active sessions for the authenticated user.

```
Authorization: Bearer <user-token>

→ 200 OK
{
  "sessions": [
    {
      "sessionId": "session-abc123",
      "name": "my-project",
      "cwd": "/Users/swapnil/code/my-project",
      "createdAt": "2026-03-05T10:00:00Z",
      "lastActivity": "2026-03-05T12:34:56Z",
      "viewerCount": 1,
      "status": "active"
    }
  ]
}
```

### `POST /auth/pair`

Validate a pairing token (from QR code scan).

```
Content-Type: application/json

{
  "token": "pair-token-xyz789"
}

→ 200 OK
{
  "sessionId": "session-abc123",
  "viewerToken": "viewer-token-...",
  "wsUrl": "wss://relay.termpod.dev/sessions/session-abc123/ws"
}
```

## Versioning

The `version` field in the `hello` message enables protocol evolution. The relay should:

1. Accept the client's version
2. Respond with the highest mutually supported version
3. Reject connections with unsupported versions

Current version: `1`
