# Architecture Overview

## System Design

Termpod follows a hub-and-spoke architecture with three components:

### 1. Desktop App (The "Worker")

The Mac app is the only component that runs an actual shell. It has two responsibilities:

**Local terminal**: Spawns PTY sessions via `tauri-plugin-pty`, renders them with xterm.js, and lets you interact normally — it's a fully functional terminal on its own.

**Relay client**: Streams PTY output to the Termpod relay over WebSocket, and receives input from remote viewers (your phone) to forward to the PTY.

```
Desktop App
├── Tauri 2.0 shell (Rust backend + WKWebView frontend)
├── React UI
│   ├── xterm.js terminal (with fit, webgl, web-links addons)
│   ├── Session sidebar (list, create, switch sessions)
│   └── Settings (relay config, theme, keybindings)
├── PTY Manager (Rust)
│   ├── tauri-plugin-pty for shell spawning
│   ├── Session lifecycle (create, resize, destroy)
│   └── Working directory tracking
└── Relay Connection (TypeScript)
    ├── WebSocket client to relay
    ├── Reconnection with exponential backoff
    └── Scrollback buffer (local copy for instant rendering)
```

### 2. Mobile App (The "Viewer")

The iOS app is a pure viewer + input device. It does NOT run a shell — it connects to the relay and renders the terminal stream.

```
Mobile App
├── Tauri 2.0 iOS shell (Rust + WKWebView)
├── React UI
│   ├── xterm.js terminal (read + write, matching desktop PTY dimensions)
│   ├── Quick Actions bar (Accept, Deny, Ctrl+C, Enter, Tab, custom)
│   ├── Smart Input field (avoids iOS dictation bugs in raw xterm)
│   ├── Session browser (list sessions, see status)
│   └── QR code scanner (for pairing)
├── Swift Plugins (via Tauri plugin system)
│   ├── Push notifications (APNs)
│   ├── Background WebSocket keep-alive
│   └── Haptic feedback on events
└── Relay Connection
    ├── WebSocket client
    ├── Scrollback request on connect
    └── Auto-reconnect on network switch
```

### 3. Relay Server (The "Hub")

The relay is a Cloudflare Worker + Durable Object that sits between all clients. Each terminal session maps to one Durable Object.

```
Cloudflare Edge
├── Worker (stateless entry point)
│   ├── POST /sessions          → create session, return token
│   ├── GET  /sessions          → list user's sessions
│   ├── GET  /sessions/:id/ws   → upgrade to WebSocket, route to DO
│   └── POST /auth/pair         → validate QR code token
└── Durable Object (one per session)
    ├── WebSocket connections (desktop + N viewers)
    ├── Scrollback buffer (circular, ~100KB, persisted in SQLite)
    ├── Session metadata (name, cwd, created_at, pty_size)
    ├── Client registry (who's connected, device type)
    └── Hibernation (sleeps when idle, wakes on message)
```

## Data Flow

### Terminal Output (Mac → Phone)

```
PTY stdout → Desktop xterm.js (local render)
          → WebSocket binary frame → Relay DO
          → DO appends to scrollback buffer
          → DO fans out to all connected viewers
          → Mobile xterm.js (remote render)
```

### Terminal Input (Phone → Mac)

```
Mobile keyboard/quick-action → WebSocket binary frame → Relay DO
                             → DO forwards to desktop WebSocket
                             → Desktop writes to PTY stdin
                             → PTY processes input
                             → Output flows back via the output path above
```

### New Viewer Connects (mid-session)

```
Mobile opens app → WebSocket connect to relay
                → Relay sends session metadata (cols, rows, cwd)
                → Relay sends full scrollback buffer
                → Mobile xterm.js writes scrollback (instant catch-up)
                → Switch to real-time streaming
```

## Key Design Decisions

### PTY lives on the Mac, not in the cloud

The shell runs locally with full access to your filesystem, credentials, SSH keys, and tools. Nothing is sandboxed or containerized. This means:
- Claude Code can read/write your actual project files
- Git operations use your real SSH keys
- Environment variables and PATH are your real ones
- The Mac must be awake for sessions to be active

This is a deliberate trade-off. Cloud-hosted PTY (like Codespaces) solves the "always on" problem but introduces complexity around file sync, credential management, and latency. For the MVP, local PTY is simpler and more powerful.

### Relay uses Durable Objects with Hibernation

Each session = one Durable Object. This gives us:
- **Single-threaded coordination**: No race conditions when multiple clients send input
- **Built-in persistence**: SQLite storage for scrollback that survives DO restarts
- **Cost efficiency**: Hibernatable WebSockets mean we only pay when data flows
- **Global edge**: DO runs near the desktop client, minimizing latency
- **No infrastructure**: No servers to manage, scales automatically

### Mobile renders at desktop PTY dimensions

The mobile terminal does NOT resize the PTY. It renders a virtual viewport matching the desktop's cols × rows, with pinch-to-zoom and horizontal scroll for overflow. This prevents:
- Desktop terminal reflowing when phone connects
- Broken TUI layouts (vim, htop, Claude Code's UI)
- Resize fight between multiple clients

### Binary frames for terminal data, JSON for control

Terminal output is raw bytes — ANSI escape codes, UTF-8 text, control characters. Parsing this into JSON would add overhead and break binary data. So terminal I/O uses WebSocket binary frames (zero copy, zero parse). Control messages (resize, auth, session management) use JSON text frames. The first byte of each binary frame is a channel ID (0x00 = terminal data, 0x01 = terminal resize, etc.) for future extensibility.

## Security Model

### Authentication flow

1. Desktop app generates a session token (cryptographically random, 256-bit)
2. Token is displayed as a QR code on the desktop
3. Mobile scans the QR code, extracts the token
4. Mobile connects to relay with the token in the WebSocket handshake
5. Relay validates the token against the session's stored token
6. Connection is established

### Transport security

- All WebSocket connections use WSS (TLS)
- Relay runs on Cloudflare's edge (DDoS protection included)
- Optional: Cloudflare Access for zero-trust auth (email/SSO)
- Optional: End-to-end encryption between desktop and mobile (relay sees ciphertext only)

### Threat model

- **Relay compromise**: If using E2E encryption, relay only sees encrypted terminal data. Without E2E, Cloudflare can theoretically see terminal content (same trust model as any HTTPS proxy).
- **Token theft**: Tokens are single-use for pairing. After pairing, a session key is derived. Tokens expire after 5 minutes.
- **Network sniffing**: TLS prevents passive eavesdropping.
