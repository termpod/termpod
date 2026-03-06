Implement the core user flow for Termpod. Here's the full architecture:

## User Flow

1. **Auth**: User signs up / logs in (on any device — Mac app or iPhone app). Auth is shared across all devices via the relay server.

2. **Device Registration**: After login, the device registers itself with the relay. Each device has a name (e.g. "Mac Studio", "MacBook Air") and a type (desktop/mobile). Desktop devices can host terminal sessions. Mobile devices (and other desktops) can view and interact with them.

3. **Dashboard**: After login, the user sees a list of all their registered devices. For example:
   - Mac Studio (online) — 3 active sessions
   - MacBook Air (offline)
   
4. **Tapping into a device**: User taps on "Mac Studio" and sees its terminal sessions:
   - ~/code/termpod (zsh) — running for 2h
   - ~/code/api (claude code) — waiting for input
   - [+ New Session]
   
5. **Joining a session**: User taps a session and gets a live terminal view. They can see all output and type input. The same session is simultaneously visible and interactive on the Mac Studio itself. Both devices are fully synced — either can type, both see the same output.

6. **Creating a session**: User taps "+ New Session" which tells the Mac Studio to spawn a new PTY. The user can optionally specify a working directory.

7. **Cross-device**: From iPhone, user can switch between Mac Studio and MacBook Air sessions. From Mac Studio, user can see what's running on MacBook Air and join those sessions too. Any device can view and interact with any other device's sessions.

## Connection Architecture

Primary: **WebRTC peer-to-peer** for direct device-to-device communication (lowest latency, no relay needed when on same network or when peers can connect directly).

Fallback: **WebSocket relay via Cloudflare Durable Objects** when peer-to-peer fails (strict NAT, cellular networks, etc.).

The relay server always handles:
- Auth and device registration
- Session discovery (which devices are online, what sessions exist)
- WebRTC signaling (exchanging SDP offers/answers and ICE candidates)
- Scrollback buffer storage (so a newly connecting device can catch up)

Data path priority:
1. Try WebRTC data channel (peer-to-peer, ~5-20ms latency)
2. Fall back to WebSocket through Durable Object relay (~30-80ms latency)
3. Connection should be seamless — user doesn't know or care which transport is active

## Tech Stack

- **iOS app**: Native Swift + SwiftUI + SwiftTerm (terminal rendering)
- **macOS app**: Tauri 2.0 + React + xterm.js (terminal rendering) + tauri-plugin-pty (shell spawning)
- **Relay**: Cloudflare Worker + Durable Objects (auth, signaling, fallback relay, scrollback storage)
- **Auth**: [decide: Cloudflare Access, custom JWT, or third-party like Clerk/Auth0]
- **WebRTC**: Native on both platforms (RTCPeerConnection on iOS, webrtc-rs or web API in Tauri)

## What to build now

Focus on the relay server and the protocol layer first:

1. **Auth endpoints** — signup, login, token refresh (JWT-based)
2. **Device registration** — POST /devices (register), GET /devices (list my devices), device heartbeat for online/offline status
3. **Session management** — GET /devices/:id/sessions (list sessions on a device), POST /devices/:id/sessions (create new session), GET /sessions/:id/ws (WebSocket upgrade for terminal data)
4. **WebRTC signaling** — POST /sessions/:id/signal (exchange SDP/ICE candidates between peers)
5. **Durable Object per session** — holds WebSocket connections, buffers scrollback, fans out terminal data, falls back when WebRTC isn't available
