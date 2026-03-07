# TermPod

**Your terminal, everywhere.**

TermPod is a shared terminal app for developers. Start a session on your Mac — run Claude Code, Codex, or any CLI tool — and pick it up on your iPhone. Both devices see the same live terminal. Type from either one.

No SSH. No tmux hacks. No VPN. Just open the app.

## How It Works

```
┌─────────┐         ┌───────────────┐         ┌─────────┐
│   Mac   │◄──ws──►│  TermPod Relay │◄──ws──►│  iPhone  │
│ (PTY +  │         │  (Cloudflare   │         │ (viewer  │
│  viewer)│         │   Durable Obj) │         │ + input) │
└─────────┘         └───────────────┘         └─────────┘
```

Your Mac runs the actual shell. The relay streams output to all connected devices and forwards input back. Sessions survive disconnects — close the app, reopen it, and you're right where you left off.

When on the same network, devices connect directly via Bonjour for lower latency.

## Features

- **Shared sessions** — Same terminal on Mac and iPhone, real-time
- **Scrollback sync** — Connect your phone mid-session, see everything that happened
- **Quick actions** — Accept/deny prompts, Ctrl+C, Enter — one tap on mobile
- **Local P2P** — Direct connection over LAN via Bonjour (no relay needed)
- **Multi-session tabs** — Multiple terminal sessions, each in its own tab
- **Session management** — Named by project directory, device-aware
- **QR code pairing** — Scan to connect as a fallback
- **Works with everything** — Claude Code, Codex, npm, docker, any CLI

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop app | Tauri 2.0 + React + xterm.js |
| Mobile app | Native SwiftUI + SwiftTerm |
| PTY | tauri-plugin-pty (Rust) |
| Relay | Cloudflare Workers + Durable Objects |
| Protocol | WebSocket (binary frames for data, JSON for control) |
| Auth | JWT + QR code pairing |
| Local transport | Bonjour / mDNS |

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
├── relay/                # Cloudflare Worker + Durable Object
│   ├── src/
│   │   ├── worker.ts     # Entry point, auth, routing
│   │   ├── session.ts    # Durable Object (WebSocket hub + scrollback)
│   │   └── jwt.ts        # JWT signing + verification
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
git clone https://github.com/user/termpod.git
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
wrangler secret put JWT_SECRET  # set your production secret
wrangler deploy
```

## Documentation

- [Architecture Overview](./docs/ARCHITECTURE.md)
- [Protocol Specification](./docs/PROTOCOL.md)
- [Development Roadmap](./docs/ROADMAP.md)

## License

MIT
