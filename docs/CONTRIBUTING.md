# Contributing to Termpod

## Development Setup

### Prerequisites

- **macOS 13+** (Ventura or later)
- **Xcode 15+** (for iOS builds and Tauri compilation)
- **Rust** (latest stable via rustup)
- **Node.js 20+** (LTS)
- **pnpm 9+** (package manager)
- **Wrangler** (Cloudflare CLI, `pnpm add -g wrangler`)

### First-time setup

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# (Optional) Add iOS targets for Tauri desktop iOS testing
# rustup target add aarch64-apple-ios aarch64-apple-ios-sim

# Clone the repo
git clone https://github.com/user/termpod.git
cd termpod

# Install dependencies
pnpm install

# Install Tauri CLI
pnpm add -g @tauri-apps/cli
```

### Running locally

```bash
# Desktop app (dev mode with hot reload)
pnpm dev:desktop

# Relay (local dev with Miniflare)
pnpm dev:relay

# iOS app (Expo, opens simulator)
pnpm dev:mobile

# Run all (desktop + relay)
pnpm dev
```

### Running tests

```bash
# All tests
pnpm test

# Specific package
pnpm --filter @termpod/relay test
pnpm --filter @termpod/protocol test

# E2E tests (requires desktop app + relay running)
pnpm test:e2e
```

## Project Structure

```
termpod/
├── apps/desktop/       → Tauri macOS app
├── apps/mobile-expo/   → Expo iOS app
├── packages/ui/        → Shared React components
├── packages/protocol/  → WebSocket message types
├── packages/shared/    → Shared utilities and constants
├── relay/              → Cloudflare Worker + Durable Object
└── docs/               → Architecture, protocol, roadmap
```

## Code Style

- TypeScript for all frontend and relay code
- Rust for Tauri backend and plugins
- Prettier for formatting (`pnpm format`)
- ESLint for linting (`pnpm lint`)
- Clippy for Rust linting (`cargo clippy`)

## Branching Strategy

- `main` — stable, deployable
- `dev` — integration branch
- `feat/*` — feature branches (branch from `dev`)
- `fix/*` — bug fixes

## Commit Messages

Follow Conventional Commits:

```
feat(desktop): add session tab management
fix(relay): handle scrollback overflow correctly
docs: update protocol spec with input lock messages
chore: bump tauri to 2.1.0
```

## Pull Request Process

1. Branch from `dev`
2. Make changes, add tests
3. Run `pnpm lint && pnpm test`
4. Open PR against `dev`
5. One approval required to merge
