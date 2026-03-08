# Contributing to TermPod

## Prerequisites

- **macOS 13+** (Ventura or later)
- **Xcode 16+** (for iOS builds)
- **Rust** (latest stable via [rustup](https://rustup.rs/))
- **Node.js 20+** (LTS)
- **pnpm 10+** (`npm install -g pnpm`)
- **XcodeGen** (`brew install xcodegen`)

## Setup

```bash
git clone https://github.com/user/termpod.git
cd termpod
pnpm install
cp .env.example .env
```

Edit `.env` with your values (see `.env.example` for all options).

## Running locally

```bash
# Desktop app (dev mode with hot reload)
pnpm dev:desktop

# Relay (local dev with Miniflare)
pnpm dev:relay

# Both at once
pnpm dev

# iOS app — generate Xcode config, then open in Xcode
pnpm ios:generate
open apps/ios/TermPod.xcodeproj
```

## Project Structure

```
termpod/
├── apps/desktop/       → Tauri macOS app (React + Rust)
├── apps/ios/           → Native iOS app (SwiftUI + SwiftTerm)
├── packages/ui/        → Shared React components
├── packages/protocol/  → WebSocket message types + binary encoding
├── packages/shared/    → Shared utilities and constants
├── relay/              → Cloudflare Worker + Durable Object
└── docs/               → Architecture, protocol spec
```

## Code Style

- **TypeScript**: Prettier for formatting (`pnpm format`), ESLint for linting
- **Rust**: Clippy (`cargo clippy`)
- **Swift**: Standard Swift conventions

## Environment Variables

All sensitive or deployment-specific values come from `.env`. Never commit secrets. Key variables:

| Variable | Used By | Purpose |
|----------|---------|---------|
| `VITE_RELAY_URL` | Desktop app | Relay WebSocket URL |
| `JWT_SECRET` | Relay server | JWT signing key |
| `APPLE_TEAM_ID` | iOS + macOS builds | Apple Developer Team ID |
| `APPLE_SIGNING_IDENTITY` | macOS builds | Code signing identity |
| `APPLE_ID` | macOS notarization | Apple ID for notarization |
| `APPLE_PASSWORD` | macOS notarization | App-specific password |

For iOS, run `pnpm ios:config` to generate `Config.xcconfig` from your `.env`.

## Making Changes

- Follow the protocol spec in [PROTOCOL.md](./PROTOCOL.md) for any WebSocket changes
- Terminal data = binary frames (channel 0x00), control = JSON text frames
- Shared React components go in `packages/ui/`, not duplicated per app
- Test relay changes with Miniflare locally before deploying
- iOS project is generated via XcodeGen — edit `project.yml`, not `.xcodeproj` directly

## Testing P2P Transports

### Local (Bonjour)
- Run the desktop app and iOS app on the same WiFi network
- The iOS app should discover the desktop via Bonjour automatically
- Transport badge should show "Local" (green) on device list and session views
- A single local WebSocket carries all sessions (multiplexed binary frames)
- Mobile subscribes/unsubscribes from sessions via `subscribe_session`/`unsubscribe_session` control messages
- Terminal data flows directly over LAN WebSocket (~1-5ms)

### WebRTC
- Connect the iOS app from a different network (e.g. cellular, different WiFi)
- WebRTC signaling flows through the Device WS (User DO); data flows P2P via DataChannel
- Transport badge should show "P2P" (blue) once the DataChannel opens
- If STUN fails (e.g. symmetric NAT), it falls back to relay after 30s timeout
- Session management (list, create, delete) works over the DataChannel

### Relay (fallback)
- If both Bonjour and WebRTC are unavailable, all data flows through the relay Device WS
- Transport badge shows "Relay" (orange)
- The relay Device WS is always connected for signaling and session management regardless of active transport

## Pull Requests

1. Branch from `main`
2. Make changes
3. Run `pnpm lint` and test locally
4. Open a PR with a clear description of what and why
