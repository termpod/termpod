# Development Roadmap

## Phase 1: Desktop Terminal MVP (Weeks 1–3)

**Goal**: A working Tauri terminal app on macOS. No relay, no mobile — just a really good local terminal.

### Week 1: Project Setup + Basic Terminal

- [ ] Initialize Turborepo monorepo with `apps/desktop`, `packages/ui`, `packages/shared`
- [ ] Scaffold Tauri 2.0 app with React + TypeScript frontend
- [ ] Install and configure `tauri-plugin-pty`
- [ ] Create `<Terminal />` component wrapping xterm.js
  - [ ] Addons: fit, webgl, web-links
  - [ ] Theme: dark default, configurable
- [ ] Wire PTY ↔ xterm.js data flow (onData/write)
- [ ] Handle terminal resize (fit addon → PTY resize)
- [ ] Single session: open app → get a shell → type commands

### Week 2: Session Management

- [ ] Multi-session support (tabbed interface)
- [ ] Create new session (spawns new PTY)
- [ ] Switch between sessions
- [ ] Close/kill session
- [ ] Track working directory per session (via OSC 7 or polling)
- [ ] Auto-name sessions from working directory
- [ ] Session persistence across app restart (reattach to running PTYs)

### Week 3: Polish + Settings

- [ ] Keyboard shortcuts (new tab, switch tab, close tab, split pane)
- [ ] Settings panel (font size, font family, theme, shell path)
- [ ] Copy/paste support
- [ ] Scrollback buffer size config
- [ ] Search in terminal output (xterm.js search addon)
- [ ] Basic app icon and window chrome
- [ ] Test on macOS 13+ (Ventura, Sonoma, Sequoia)

**Milestone**: A terminal app you'd actually want to use daily.

---

## Phase 2: Relay Server (Weeks 4–5)

**Goal**: A Cloudflare Worker + Durable Object relay that desktop can stream to.

### Week 4: Relay Core

- [ ] Scaffold Cloudflare Worker project with Wrangler
- [ ] Define WebSocket protocol (see PROTOCOL.md)
  - [ ] Binary frames for terminal data
  - [ ] JSON frames for control messages
- [ ] Implement Durable Object: `TerminalSession`
  - [ ] Accept WebSocket connections (desktop + viewers)
  - [ ] Receive terminal output from desktop, fan out to viewers
  - [ ] Receive input from viewers, forward to desktop
  - [ ] Circular scrollback buffer (~100KB)
  - [ ] Persist scrollback in SQLite storage
  - [ ] Hibernatable WebSocket API integration
- [ ] Worker routes:
  - [ ] `POST /sessions` — create session, return ID + token
  - [ ] `GET /sessions` — list sessions for user
  - [ ] `GET /sessions/:id/ws` — WebSocket upgrade → route to DO

### Week 5: Desktop ↔ Relay Integration

- [ ] Add WebSocket client to desktop app
- [ ] Stream PTY output to relay (binary frames)
- [ ] Receive remote input from relay → write to PTY
- [ ] Handle reconnection (exponential backoff, scrollback delta sync)
- [ ] Token generation + QR code display in desktop app
- [ ] Session status indicators (connected to relay, viewers count)
- [ ] Deploy relay to Cloudflare (production)
- [ ] Test with Miniflare locally during development

**Milestone**: Desktop terminal streams to relay. You can verify by connecting via a browser WebSocket client.

---

## Phase 3: Mobile App (Weeks 6–8)

**Goal**: An iOS app that connects to the relay and lets you view + interact with your terminal sessions.

### Week 6: Mobile Shell + Terminal Viewer

- [ ] Initialize Expo app in `apps/mobile-expo`
- [ ] Share `packages/ui` components with desktop
- [ ] Configure xterm.js for iOS WebView (WKWebView quirks)
- [ ] Connect to relay via WebSocket
- [ ] Receive scrollback buffer on connect → render in xterm.js
- [ ] Real-time terminal output streaming
- [ ] Read-only mode working end-to-end
- [ ] Test on iOS Simulator + physical iPhone

### Week 7: Mobile Input + Quick Actions

- [ ] Smart Input field (native text input → send to terminal on submit)
  - [ ] Handles iOS dictation correctly (no duplicate words)
  - [ ] Send on Enter, with option for multi-line
- [ ] Quick Actions bar
  - [ ] Ctrl+C (interrupt)
  - [ ] Enter (confirm)
  - [ ] Tab (autocomplete)
  - [ ] Arrow keys (up/down for history)
  - [ ] Accept / Deny buttons (for Claude Code permission prompts)
  - [ ] Custom actions (user-configurable)
- [ ] QR code scanner for session pairing
- [ ] Session browser (list, select, see status)
- [ ] Pull-to-refresh session list

### Week 8: Mobile Polish

- [ ] Push notifications via Swift Tauri plugin
  - [ ] "Process needs input" (Claude Code waiting for approval)
  - [ ] "Process completed" (long-running command finished)
  - [ ] "Session disconnected" (Mac went to sleep)
- [ ] Background WebSocket keep-alive
- [ ] Haptic feedback on events
- [ ] Responsive terminal rendering (pinch-to-zoom, horizontal scroll)
- [ ] Dark/light mode following iOS system setting
- [ ] App icon + launch screen
- [ ] TestFlight build

**Milestone**: Full loop working — start Claude Code on Mac, scan QR on iPhone, see output, approve prompts from phone.

---

## Phase 4: Production Readiness (Weeks 9–11)

**Goal**: Stable, secure, and ready for other people to use.

### Week 9: Security + Auth

- [ ] End-to-end encryption (optional, desktop ↔ mobile, relay sees ciphertext)
- [ ] Token expiry (5 min for pairing QR codes)
- [ ] Session key rotation
- [ ] Rate limiting on relay (per-session, per-IP)
- [ ] Input validation on all WebSocket messages
- [ ] Cloudflare Access integration (optional zero-trust)
- [ ] Security audit of the protocol

### Week 10: Reliability + Performance

- [ ] Reconnection stress testing (network drops, sleep/wake cycles)
- [ ] Scrollback buffer edge cases (buffer overflow, binary data, huge output)
- [ ] Latency benchmarking (target: <100ms input → output round trip)
- [ ] Memory profiling (desktop app with many sessions)
- [ ] Durable Object hibernation testing (wake latency, state recovery)
- [ ] Error handling throughout (relay down, PTY crash, WebSocket close)
- [ ] Crash reporting (Sentry or similar)

### Week 11: Distribution

- [ ] macOS code signing + notarization
- [ ] DMG packaging with Tauri bundler
- [ ] iOS App Store submission (provisioning, review guidelines)
- [ ] Landing page (termpod.dev)
- [ ] GitHub repo setup (public or private)
- [ ] Documentation (user guide, FAQ)
- [ ] Demo video / GIF for README

**Milestone**: v1.0 — installable macOS app + iOS app on TestFlight/App Store.

---

## Phase 5: Growth Features (Weeks 12+)

These are post-launch features based on user feedback:

- [ ] **Multi-viewer**: Multiple people watching the same session (pair programming)
- [ ] **Session recording**: Replay terminal sessions (like asciinema)
- [ ] **Web viewer**: Browser-based viewer (no app install needed)
- [ ] **Android app**: Tauri 2.0 Android target
- [ ] **Windows support**: Tauri works on Windows too
- [ ] **Split panes**: Multiple terminals in one view
- [ ] **Claude Code integration**: Detect Claude Code prompts, show structured approve/deny UI
- [ ] **Team features**: Shared sessions with org-level auth
- [ ] **Always-on mode**: Optional cloud PTY (Cloudflare Containers) for sessions that survive Mac sleep

---

## Technical Debt & Risks

### Known Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Expo/RN maturity for terminal UX | Mobile terminal rendering may have quirks | Custom WebView-based terminal renderer |
| tauri-plugin-pty is v0.1.1 | API may change, bugs likely | Pin version, contribute fixes upstream, keep portable-pty as backup |
| Terminal rendering on mobile | iOS WebView quirks with keyboard, selection | Test early (Week 6), custom input handling |
| Durable Object cold starts | First connection after hibernation may lag | Pre-warm with alarm, optimize DO init |
| App Store review | Apple may reject terminal apps | Emphasize "developer tool" category, comply with guidelines |

### Technical Debt to Watch

- Shared `packages/ui` may diverge between desktop and mobile needs
- WebSocket protocol versioning (add version field from day 1)
- Scrollback buffer memory management on mobile (limit buffer size)
- Testing strategy for E2E flows across 3 components
