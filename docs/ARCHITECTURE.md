# Architecture Overview

## System Design

TermPod follows a hub-and-spoke architecture with three components:

### 1. Desktop App (The "Worker")

The Mac app is the only component that runs an actual shell. It has two responsibilities:

**Local terminal**: Spawns PTY sessions via `tauri-plugin-pty`, renders them with xterm.js, and lets you interact normally — it's a fully functional terminal on its own.

**Relay client**: Streams PTY output to the TermPod relay over WebSocket, and receives input from remote viewers (your phone) to forward to the PTY.

```
Desktop App
├── Tauri 2.0 shell (Rust backend + WKWebView frontend)
├── React UI
│   ├── xterm.js terminal (with fit, webgl, web-links addons)
│   ├── Session tabs (create, switch, close sessions)
│   └── Settings (relay config, theme, font)
├── PTY Manager (Rust)
│   ├── tauri-plugin-pty for shell spawning
│   ├── Session lifecycle (create, resize, destroy)
│   └── Working directory tracking
├── Local Server (Rust)
│   ├── WebSocket server for LAN connections
│   └── Bonjour/mDNS advertisement via dns-sd
├── WebRTC (TypeScript)
│   ├── DataChannel for P2P terminal data + control messages
│   ├── Signaling via relay (offer/answer/ICE)
│   └── ICE servers: Google + Cloudflare STUN, optional Cloudflare TURN
├── E2E Encryption (TypeScript — packages/protocol/src/crypto.ts)
│   ├── ECDH P-256 key exchange with viewer
│   ├── AES-256-GCM encryption (HKDF-SHA256 derived key)
│   └── Counter-based nonces
└── Relay Connection (TypeScript)
    ├── WebSocket client to relay
    ├── Reconnection with exponential backoff
    └── JWT auth
```

### 2. Mobile App (The "Viewer")

The iOS app is a native Swift app. It does NOT run a shell — it connects to the desktop (directly or via relay) and renders the terminal stream.

```
iOS App (SwiftUI + SwiftTerm)
├── Terminal rendering (SwiftTerm — native CoreText)
├── Connection Manager (orchestrates all transports)
│   ├── Local transport (Bonjour discovery → direct WebSocket)
│   ├── WebRTC transport (P2P DataChannel via livekit/webrtc)
│   └── Relay transport (WebSocket via Cloudflare)
├── E2E Encryption (CryptoKit — Services/CryptoService.swift)
│   ├── ECDH P-256 key exchange with desktop
│   ├── AES-256-GCM decryption/encryption
│   └── HKDF-SHA256 key derivation
├── Auth (JWT stored in Keychain)
├── Device & session discovery
└── Special keys bar (Ctrl, Esc, Tab, arrows)
```

### 3. Relay Server (The "Hub")

The relay is a Cloudflare Worker + two Durable Object types. The User DO acts as the device-level control plane; the TerminalSession DO handles per-session binary relay and scrollback.

```
Cloudflare Edge
├── Worker (stateless entry point)
│   ├── Auth: POST /auth/signup, /auth/login, /auth/refresh
│   ├── Devices: GET/POST/DELETE /devices, heartbeat, offline
│   ├── Sessions: GET/POST /devices/:id/sessions, DELETE/PATCH /sessions/:id
│   ├── Device WS: /devices/:id/ws    → route to User DO
│   ├── Session WS: /sessions/:id/ws  → route to TerminalSession DO
│   └── Auto-update: /updates/latest.json, /updates/download/:filename
└── Durable Objects
    ├── User (one per email) — device-level control plane
    │   ├── Device WS connections (desktop + N mobile viewers)
    │   ├── Forwards control messages between desktop ↔ mobile
    │   ├── WebRTC signaling relay (offer/answer/ICE)
    │   ├── Persists device list + session metadata in SQLite
    │   └── Hibernatable WebSockets (cost efficient)
    └── TerminalSession (one per session) — binary data relay
        ├── Session WS connections (desktop + N viewers)
        ├── Scrollback buffer (circular, persisted in SQLite)
        ├── Session metadata (name, cwd, pty_size)
        └── Hibernation (sleeps when idle, wakes on message)
```

## Data Flow

### Terminal Output (Mac → Phone)

```
PTY stdout → Desktop xterm.js (local render)
          → E2E encrypt (AES-256-GCM) → [0xE0][nonce][ciphertext]
          → WebSocket binary frame → Relay DO
          → DO appends to scrollback buffer (plaintext 0x00 frames only)
          → DO fans out encrypted frames to all connected viewers
          → Mobile E2E decrypt → SwiftTerm (remote render)
```

### Terminal Input (Phone → Mac)

```
Mobile keyboard → E2E encrypt → WebSocket binary frame → Relay DO
               → DO forwards encrypted frame to desktop WebSocket
               → Desktop E2E decrypt → writes to PTY stdin
               → PTY processes input
               → Output flows back via the output path above
```

Note: E2E encryption applies to relay transport only. Local (Bonjour) and WebRTC transports send plaintext binary frames (local is trusted network; WebRTC has built-in DTLS encryption). Scrollback remains plaintext for v1.

### Device-Level Transport Architecture

All transports operate at the **device level**, not per-session. A single connection carries multiplexed data for all active sessions using the multiplexed binary frame format:

```
[channel:u8][sid_len:u8][session_id:utf8][payload:bytes]
```

This means one Bonjour connection, one WebRTC DataChannel, and one relay Device WS handle all sessions for a device. The mobile app subscribes/unsubscribes from individual sessions as the user navigates.

### Local P2P (Same Network)

When both devices are on the same LAN, the mobile app connects directly to the desktop via Bonjour, bypassing the relay entirely:

```
iPhone discovers Mac via Bonjour (_termpod._tcp)
 → Resolves IP + port
 → Direct WebSocket connection (ws://)
 → Sends subscribe_session for each session to view
 → Receives multiplexed binary frames for subscribed sessions
 → ~1-5ms latency vs ~30-80ms via relay
```

### WebRTC P2P (Different Networks)

When devices are on different networks, a WebRTC DataChannel provides a peer-to-peer path that avoids the relay hop:

```
Desktop creates WebRTC offer
 → Offer sent to mobile via Device WS (toClientId targeting)
 → Mobile creates answer, sent back via Device WS
 → ICE candidates exchanged (STUN: Google + Cloudflare, optional TURN)
 → DataChannel opens → multiplexed binary data + JSON control messages
 → ~10-30ms latency (TURN used when STUN fails, relay WS as final fallback)
```

WebRTC signaling flows through the Device WS (User DO), not the per-session WS. A 30-second connection timeout automatically falls back to relay if negotiation fails.

### Transport Priority and Data Flow

Transport priority: **Local WS (Bonjour) > WebRTC DataChannel > Relay Device WS**

The mobile app receives data from **all** connected transports simultaneously (whichever delivers first), but sends through the **best available** transport only. The relay Device WS is always connected regardless of P2P status — it serves as the fallback data path and the control plane for session management and WebRTC signaling.

### New Viewer Connects (mid-session)

```
Mobile opens app → WebSocket connect to relay
                → Relay sends session metadata (cols, rows, cwd)
                → Relay sends full scrollback buffer
                → Mobile SwiftTerm writes scrollback (instant catch-up)
                → Switch to real-time streaming
```

## Key Design Decisions

### PTY lives on the Mac, not in the cloud

The shell runs locally with full access to your filesystem, credentials, SSH keys, and tools. Nothing is sandboxed or containerized. This means:
- Claude Code can read/write your actual project files
- Git operations use your real SSH keys
- Environment variables and PATH are your real ones
- The Mac must be awake for sessions to be active

### Relay uses Durable Objects with Hibernation

Two DO types: **User DO** (one per account, device-level control plane) and **TerminalSession DO** (one per session, binary data relay). This gives us:
- **Single-threaded coordination**: No race conditions when multiple clients send input
- **Built-in persistence**: SQLite storage for scrollback and device/session metadata
- **Cost efficiency**: Hibernatable WebSockets mean we only pay when data flows
- **Global edge**: DO runs near the desktop client, minimizing latency

### Device-level multiplexing over single connections

Instead of one WebSocket per session, each transport (Bonjour, WebRTC, relay) maintains a single device-level connection. Sessions are multiplexed using a binary frame prefix: `[channel][sid_len][session_id][payload]`. This reduces connection overhead and simplifies transport management.

### Binary frames for terminal data, JSON for control

Terminal output is raw bytes — ANSI escape codes, UTF-8 text, control characters. Terminal I/O uses WebSocket binary frames (zero copy, zero parse). Control messages (resize, auth, session management) use JSON text frames. The first byte of each binary frame is a channel ID for extensibility. See [PROTOCOL.md](./PROTOCOL.md) for details.

### Security: E2E encryption and transport auth

Each transport has its own security model:

- **Relay**: E2E encrypted. Desktop and viewer perform an ECDH P-256 key exchange (via `key_exchange`/`key_exchange_ack` control messages), derive a shared AES-256-GCM key using HKDF-SHA256 (with session ID as info), and encrypt all terminal data as `[0xE0][nonce:12][ciphertext+tag]` frames. The relay forwards these frames blindly — it cannot read terminal data. Desktop uses Web Crypto (`packages/protocol/src/crypto.ts`), iOS uses CryptoKit (`CryptoService.swift`).
- **Local (Bonjour)**: Authenticated via shared secret. Desktop generates a random auth secret on startup and shares it with iOS through the authenticated relay Device WS (`local_auth_secret` message). iOS must send this secret as the first message on the local WebSocket; the desktop Rust server validates it before accepting any other messages.
- **WebRTC**: E2E encrypted by design — DTLS secures the DataChannel at the transport layer.

### Auto-updates via relay proxy

Desktop app auto-updates are served through the relay (`/updates/latest.json`, `/updates/download/:filename`), which proxies GitHub releases. This allows updates to work even from private repos without exposing GitHub tokens to clients.

## Configuration

All sensitive values are configured via environment variables. See `.env.example` for the full list:

- `VITE_RELAY_URL` — Relay WebSocket URL (desktop app, via Vite)
- `JWT_SECRET` — Relay server signing key (Cloudflare Worker secret)
- `APPLE_TEAM_ID` — Apple Developer Team ID (iOS + macOS signing)
- `APPLE_SIGNING_IDENTITY` — macOS code signing identity
- `TURN_KEY_ID` — Cloudflare TURN key ID (optional, for WebRTC across symmetric NATs)
- `TURN_KEY_API_TOKEN` — Cloudflare TURN API token (optional)

The iOS app reads relay URL and team ID from `Config.xcconfig`, generated from `.env` by `apps/ios/generate-config.sh`.

TURN is optional — if not configured, the relay returns 503 and clients fall back to STUN-only with the relay WebSocket as the final fallback transport.
