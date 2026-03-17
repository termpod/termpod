# TermPod

**Your terminal, everywhere.**

TermPod is a shared terminal app for developers. Start a session on your Mac — run Claude Code, Codex, or any CLI tool — and pick it up on your iPhone. Both devices see the same live terminal. Type from either one.

No SSH. No tmux hacks. No VPN. Just open the app.

## How It Works

```
                    ┌────────────────┐
                    │  TermPod Relay │
                    │  (Cloudflare   │
                    │   Durable Obj) │
                    └───▲────────▲───┘
                   ws   │        │  ws
           ┌────────────┘        └────────────┐
           │                                  │
     ┌─────▼───┐  bonjour / webrtc (P2P)  ┌──▼──────┐
     │   Mac   │◄────────────────────────►│  iPhone │
     │ (PTY +  │                          │ (viewer │
     │  viewer)│                          │ + input)│
     └─────────┘                          └─────────┘
```

Your Mac runs the actual shell. Devices connect in the fastest way available:

1. **Local WebSocket** — Same LAN? Direct connection via Bonjour (~1-5ms)
2. **WebRTC P2P** — Different networks? Peer-to-peer data channel via STUN/TURN (~10-30ms)
3. **Relay** — Fallback through Cloudflare (~30-80ms)

Sessions survive disconnects — close the app, reopen it, and you're right where you left off.

## Features

- **Shared sessions** — Same terminal on Mac and iPhone, real-time
- **Scrollback sync** — Connect your phone mid-session, see everything that happened
- **Quick actions** — Accept/deny prompts, Ctrl+C, Enter — one tap on mobile
- **Local P2P** — Direct connection over LAN via Bonjour (no relay needed)
- **WebRTC P2P** — Peer-to-peer across networks via STUN/TURN, relay as fallback
- **Multi-session tabs** — Multiple terminal sessions, each in its own tab
- **Session management** — Named by project directory, device-aware
- **Auto-updates** — Desktop app updates automatically via relay proxy
- **E2E encryption** — Relay transport encrypted with ECDH + AES-256-GCM; relay can't read your data
- **Local auth** — Bonjour connections authenticated via shared secret exchanged over relay
- **Password reset** — Email-based 6-digit code reset via Resend
- **Error tracking** — Sentry integration across desktop, relay, and iOS
- **Works with everything** — Claude Code, Codex, npm, docker, any CLI

## Tech Stack

| Layer           | Technology                                                                  |
| --------------- | --------------------------------------------------------------------------- |
| Desktop app     | Tauri 2.0 + React + xterm.js                                                |
| Mobile app      | Native SwiftUI + SwiftTerm                                                  |
| PTY             | tauri-plugin-pty (Rust)                                                     |
| Relay           | Cloudflare Workers + Durable Objects                                        |
| Protocol        | WebSocket (binary frames for data, JSON for control)                        |
| Transport       | Device-level multiplexed connections (single WS per transport)              |
| Auth            | JWT (HS256)                                                                 |
| Security        | E2E: ECDH P-256 + AES-256-GCM (relay), DTLS (WebRTC), shared secret (local) |
| Local transport | Bonjour / mDNS                                                              |
| P2P transport   | WebRTC DataChannel (livekit/webrtc)                                         |
| Auto-update     | tauri-plugin-updater via relay proxy                                        |

## Project Structure

```
termpod/
├── apps/
│   ├── desktop/          # Tauri 2.0 macOS app
│   │   ├── src/          # React frontend
│   │   ├── src-tauri/    # Rust backend + PTY management
│   │   └── package.json
│   └── ios/              # Native iOS app (SwiftUI + SwiftTerm)
│       ├── TermPod/      # Swift source
│       ├── project.yml   # XcodeGen project spec
│       └── generate-config.sh
├── packages/
│   ├── ui/               # Shared React components
│   ├── protocol/         # WebSocket message types + binary encoding
│   └── shared/           # Constants, types, utilities
├── relay/                # Cloudflare Worker + Durable Objects
│   ├── src/
│   │   ├── worker.ts     # Entry point, auth, routing, auto-update proxy
│   │   ├── user.ts       # User DO (device control plane, session mgmt)
│   │   ├── session.ts    # TerminalSession DO (binary relay + scrollback)
│   │   ├── jwt.ts        # JWT signing + verification
│   │   └── auth.ts       # Password hashing (PBKDF2)
│   └── wrangler.toml
├── docs/                 # Architecture docs
├── turbo.json            # Turborepo config
└── package.json          # Workspace root
```

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 10+
- [Rust](https://rustup.rs/) (for Tauri)
- [Xcode](https://developer.apple.com/xcode/) 16+ (for iOS)
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`)
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) (for relay, installed via pnpm)

## Setup

### 1. Clone and install

```bash
git clone https://github.com/termpod/termpod.git
cd termpod
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:

```bash
# Relay URL (use default or your own deployment)
VITE_RELAY_URL=wss://relay.termpod.dev

# JWT secret for the relay server
JWT_SECRET=your-random-secret-here

# Apple Developer (for code signing)
APPLE_TEAM_ID=YOUR_TEAM_ID
APPLE_SIGNING_IDENTITY=Developer ID Application: Your Name (YOUR_TEAM_ID)

# Apple notarization (only needed for distribution builds)
APPLE_ID=your-apple-id@example.com
APPLE_PASSWORD=your-app-specific-password

# Resend (for password reset emails — set via wrangler secret)
# RESEND_API_KEY=re_xxxx

# Sentry error tracking (optional)
VITE_SENTRY_DSN=
# SENTRY_DSN= (relay: wrangler secret, iOS: via generate-config.sh)

# Cloudflare TURN (optional, for WebRTC P2P across restrictive NATs)
# Create at: https://dash.cloudflare.com → Calls → TURN Keys
# TURN_KEY_ID=your-turn-key-id
# TURN_KEY_API_TOKEN=your-turn-api-token

# GitHub token (for update proxy — needs repo read access to private releases)
# Set via: wrangler secret put GITHUB_TOKEN
# GITHUB_TOKEN=ghp_xxxx

# Tauri updater signing (must be set in shell env, NOT .env file)
# TAURI_SIGNING_PRIVATE_KEY=content-or-path-to-private-key
# TAURI_SIGNING_PRIVATE_KEY_PASSWORD=
```

### 3. Run in development

```bash
# Desktop app (dev mode, no signing needed)
pnpm dev:desktop

# Relay server (local via miniflare)
pnpm dev:relay

# Both at once
pnpm dev
```

### 4. iOS app

```bash
# Generate Xcode config from .env and regenerate .xcodeproj
pnpm ios:generate

# Open in Xcode
open apps/ios/TermPod.xcodeproj
```

Build and run from Xcode on a simulator or device. The `APPLE_TEAM_ID` from your `.env` is used for code signing automatically.

### 5. Production builds

```bash
# Desktop (sources .env for signing identity + notarization)
cd apps/desktop
pnpm build:release

# Relay (deploy to Cloudflare)
cd relay
wrangler secret put JWT_SECRET           # required
wrangler secret put RESEND_API_KEY       # for password reset emails
wrangler secret put SENTRY_DSN           # optional, error tracking
wrangler secret put GITHUB_TOKEN         # for update proxy
wrangler secret put TURN_KEY_ID          # optional, for TURN support
wrangler secret put TURN_KEY_API_TOKEN
wrangler deploy
```

## Documentation

- [Architecture Overview](./docs/ARCHITECTURE.md)
- [Protocol Specification](./docs/PROTOCOL.md)
- [Contributing](./docs/CONTRIBUTING.md)

## License

MIT
