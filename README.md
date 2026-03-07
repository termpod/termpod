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

## Features

- **Shared sessions** — Same terminal on Mac and iPhone, real-time
- **Scrollback sync** — Connect your phone mid-session, see everything that happened
- **Quick actions** — Accept/deny prompts, Ctrl+C, Enter — one tap on mobile
- **Push notifications** — Know when a process needs input or finishes
- **Session management** — Multiple sessions, named by project directory
- **QR code pairing** — Scan to connect, no account needed
- **Works with everything** — Claude Code, Codex, npm, docker, any CLI

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop app | Tauri 2.0 + React + xterm.js |
| Mobile app | Tauri 2.0 iOS + React + xterm.js |
| PTY | tauri-plugin-pty (Rust) |
| Relay | Cloudflare Workers + Durable Objects |
| Protocol | WebSocket (binary frames for data, JSON for control) |
| Auth | Token-based with QR code pairing |

## Project Structure

```
termpod/
├── apps/
│   ├── desktop/          # Tauri 2.0 macOS app
│   │   ├── src/          # React frontend (shared with mobile)
│   │   ├── src-tauri/    # Rust backend + PTY management
│   │   └── package.json
│   └── mobile/           # Tauri 2.0 iOS app
│       ├── src/          # React frontend (shared with desktop)
│       ├── src-tauri/    # Rust backend + Swift plugins
│       └── package.json
├── packages/
│   ├── ui/               # Shared React components
│   │   ├── terminal/     # xterm.js wrapper + addons
│   │   ├── session-list/ # Session browser
│   │   └── quick-actions/# Mobile action bar
│   ├── protocol/         # WebSocket message types + serialization
│   └── shared/           # Constants, types, utilities
├── relay/                # Cloudflare Worker + Durable Object
│   ├── src/
│   │   ├── worker.ts     # Entry point, auth, routing
│   │   ├── session.ts    # Durable Object (WebSocket hub + scrollback)
│   │   └── auth.ts       # Token generation + validation
│   └── wrangler.toml
├── docs/                 # Architecture docs, ADRs
├── turbo.json            # Turborepo config
└── package.json          # Workspace root
```

## Getting Started

```bash
# Clone and install
git clone https://github.com/user/termpod.git
cd termpod
pnpm install

# Run desktop app in dev mode
pnpm dev:desktop

# Run relay locally (miniflare)
pnpm dev:relay

# Run iOS app in simulator
pnpm dev:mobile
```

## Documentation

- [Architecture Overview](./docs/ARCHITECTURE.md)
- [Development Roadmap](./docs/ROADMAP.md)
- [Protocol Specification](./docs/PROTOCOL.md)
- [Contributing](./docs/CONTRIBUTING.md)

## License

MIT
