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
│   └── STUN servers: Google + Cloudflare (no TURN)
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
          → WebSocket binary frame → Relay DO
          → DO appends to scrollback buffer
          → DO fans out to all connected viewers
          → Mobile SwiftTerm (remote render)
```

### Terminal Input (Phone → Mac)

```
Mobile keyboard → WebSocket binary frame → Relay DO
               → DO forwards to desktop WebSocket
               → Desktop writes to PTY stdin
               → PTY processes input
               → Output flows back via the output path above
```

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
 → ICE candidates exchanged (STUN: Google + Cloudflare)
 → DataChannel opens → multiplexed binary data + JSON control messages
 → ~10-30ms latency (no TURN — relay is the fallback if STUN fails)
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

### Auto-updates via relay proxy

Desktop app auto-updates are served through the relay (`/updates/latest.json`, `/updates/download/:filename`), which proxies GitHub releases. This allows updates to work even from private repos without exposing GitHub tokens to clients.

## Configuration

All sensitive values are configured via environment variables. See `.env.example` for the full list:

- `VITE_RELAY_URL` — Relay WebSocket URL (desktop app, via Vite)
- `JWT_SECRET` — Relay server signing key (Cloudflare Worker secret)
- `APPLE_TEAM_ID` — Apple Developer Team ID (iOS + macOS signing)
- `APPLE_SIGNING_IDENTITY` — macOS code signing identity

The iOS app reads relay URL and team ID from `Config.xcconfig`, generated from `.env` by `apps/ios/generate-config.sh`.
