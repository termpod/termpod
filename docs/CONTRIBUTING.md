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
git clone https://github.com/termpod/termpod.git
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

- **TypeScript**: Prettier for formatting (`pnpm format`), `tsc --noEmit` for type checking (`pnpm lint`)
- **Rust**: Clippy (`cargo clippy`)
- **Swift**: Standard Swift conventions

## Environment Variables

All sensitive or deployment-specific values come from `.env`. Never commit secrets. Key variables:

| Variable                 | Used By            | Purpose                               |
| ------------------------ | ------------------ | ------------------------------------- |
| `VITE_RELAY_URL`         | Desktop app        | Relay WebSocket URL                   |
| `JWT_SECRET`             | Relay server       | JWT signing key                       |
| `RESEND_API_KEY`         | Relay server       | Email service for password reset      |
| `VITE_SENTRY_DSN`        | Desktop app        | Sentry error tracking (optional)      |
| `SENTRY_DSN`             | Relay + iOS        | Sentry error tracking (optional)      |
| `APPLE_TEAM_ID`          | iOS + macOS builds | Apple Developer Team ID               |
| `APPLE_SIGNING_IDENTITY` | macOS builds       | Code signing identity                 |
| `APPLE_ID`               | macOS notarization | Apple ID for notarization             |
| `APPLE_PASSWORD`         | macOS notarization | App-specific password                 |
| `GITHUB_TOKEN`           | Relay server       | Update proxy (GitHub release access)  |
| `TURN_KEY_ID`            | Relay server       | Cloudflare TURN for WebRTC (optional) |
| `TURN_KEY_API_TOKEN`     | Relay server       | Cloudflare TURN for WebRTC (optional) |

For iOS, run `pnpm ios:generate` to generate `Config.xcconfig` from your `.env` and regenerate the Xcode project.

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

## Security

TermPod uses E2E encryption on all transports. The relay is zero-knowledge — it cannot read terminal data or session metadata. Key things to know:

- **Relay is zero-knowledge**: The relay only forwards `0xE0` (authenticated E2E) and `0xE1` (share E2E) encrypted frames blindly. Plaintext `0x00` terminal data is rejected. No plaintext scrollback is stored. Session metadata (name, cwd, processName) is never stored — relay only persists non-sensitive fields (IDs, PTY dimensions).
- **Never send sensitive data in plaintext to the relay**: Terminal data, session names, cwds, and process names must always go through E2E encrypted channels (`encrypted_control` on Device WS, `0xE0` frames on Session WS).
- **Crypto implementations**: Desktop uses Web Crypto API (`packages/protocol/src/crypto.ts`), iOS uses CryptoKit (`apps/ios/TermPod/Services/CryptoService.swift`). Changes to the encryption protocol must be updated in both.
- **Key exchange**: ECDH P-256 via `key_exchange`/`key_exchange_ack` control messages, AES-256-GCM with HKDF-SHA256 derived keys. See [PROTOCOL.md](./PROTOCOL.md) for the full spec.
- **Local transport**: Bonjour connections require an auth secret (shared E2E encrypted via relay Device WS) + same ECDH/AES-256-GCM encryption as relay. Desktop initiates key exchange on viewer join.
- **WebRTC**: Inherently E2E encrypted via DTLS on DataChannel.

## Pull Requests

1. Branch from `main`
2. Make changes
3. Run `pnpm lint` and test locally
4. Open a PR with a clear description of what and why
