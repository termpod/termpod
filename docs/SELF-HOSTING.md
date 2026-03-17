# Self-Hosting the Relay

TermPod's relay server runs on Cloudflare Workers + Durable Objects. You can self-host it on Cloudflare's free tier.

## What the relay does

The relay handles:

- **Auth**: Signup, login, token refresh, password reset
- **Device management**: Registration, heartbeat, session tracking
- **WebSocket routing**: Forwards encrypted terminal data between desktop and mobile
- **WebRTC signaling**: Exchanges offers/answers/ICE candidates for P2P connections
- **Auto-update proxy**: Serves desktop app updates from GitHub releases

The relay is **zero-knowledge** — all terminal data is E2E encrypted (ECDH + AES-256-GCM). The relay forwards opaque ciphertext and cannot read your terminal content.

## Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 10+

## Setup

### 1. Clone and install

```bash
git clone https://github.com/termpod/termpod.git
cd termpod
pnpm install
```

### 2. Configure wrangler

The relay config lives in `relay/wrangler.toml`. The defaults work out of the box. If you want a custom worker name:

```toml
name = "my-termpod-relay"
```

### 3. Set secrets

```bash
cd relay

# Required
wrangler secret put JWT_SECRET
# Generate a strong random string (e.g. openssl rand -base64 32)

# Required for password reset emails
wrangler secret put RESEND_API_KEY
# Get from https://resend.com → API Keys

# Required for password reset — your sending address
wrangler secret put EMAIL_FROM
# Format: "YourApp <noreply@email.yourdomain.com>"
# You must verify this domain in Resend first
```

### 4. Deploy

```bash
wrangler deploy
```

Wrangler will output your relay URL, e.g. `https://my-termpod-relay.your-account.workers.dev`.

### 5. Point clients to your relay

**Desktop**: Set in `.env` before building:

```bash
VITE_RELAY_URL=wss://my-termpod-relay.your-account.workers.dev
```

**iOS**: Set in `.env` then regenerate config:

```bash
VITE_RELAY_URL=wss://my-termpod-relay.your-account.workers.dev
pnpm ios:generate
```

The desktop app also supports changing the relay URL at runtime in Settings → Connection.

## Optional secrets

```bash
# Error tracking (Sentry)
wrangler secret put SENTRY_DSN

# Desktop auto-update proxy (needs GitHub repo read access)
wrangler secret put GITHUB_TOKEN

# WebRTC TURN relay (for P2P across restrictive NATs)
# Create at: https://dash.cloudflare.com → Calls → TURN Keys
wrangler secret put TURN_KEY_ID
wrangler secret put TURN_KEY_API_TOKEN
```

## Custom domain

To use your own domain instead of `*.workers.dev`:

1. Add the domain to your Cloudflare account
2. In the Cloudflare dashboard, go to Workers & Pages → your worker → Settings → Domains & Routes
3. Add a custom domain (e.g. `relay.yourdomain.com`)
4. Update `VITE_RELAY_URL` in your client configs to `wss://relay.yourdomain.com`

## Email setup (Resend)

Password reset requires a verified sending domain in Resend:

1. Sign up at [resend.com](https://resend.com)
2. Add your sending domain (e.g. `email.yourdomain.com`) — use a subdomain to protect your root domain's reputation
3. Add the DNS records Resend provides (SPF, DKIM, DMARC)
4. Create an API key and set it via `wrangler secret put RESEND_API_KEY`
5. Set your sending address via `wrangler secret put EMAIL_FROM` (e.g. `YourApp <noreply@email.yourdomain.com>`)

If `RESEND_API_KEY` is not configured, the relay returns 503 for password reset requests. Everything else works normally.

## Cloudflare free tier limits

The relay runs comfortably on Cloudflare's free tier:

| Resource            | Free tier limit        | Typical TermPod usage       |
| ------------------- | ---------------------- | --------------------------- |
| Worker requests     | 100K/day               | ~1K/day per active user     |
| Durable Objects     | Included               | 1 User DO per account       |
| DO storage (SQLite) | 1 GB                   | ~1 KB per user              |
| DO WebSocket msgs   | Included (hibernation) | Only billed when data flows |
| Bandwidth           | Unlimited              | Terminal data is small      |

For most personal and small-team use, you will never exceed the free tier.

## Architecture notes

- **User DO** (one per email): Stores device list, session metadata (non-sensitive fields only), share tokens. Handles Device WS connections, session management, WebRTC signaling, and rate limiting.
- **TerminalSession DO** (one per session): Forwards encrypted binary frames between desktop and viewers. Stores no terminal data. Hibernates when idle.
- **Migrations**: Defined in `wrangler.toml`. v1 adds TerminalSession DO with SQLite, v2 adds User DO with SQLite. Cloudflare applies these automatically on deploy.

## Updating

Pull the latest changes and redeploy:

```bash
git pull
cd relay
pnpm deploy
```

Durable Object migrations are applied automatically. No manual database steps required.

## Troubleshooting

**"Email service not configured" on password reset**: Set `RESEND_API_KEY` and `EMAIL_FROM` secrets.

**WebRTC not working across networks**: Set `TURN_KEY_ID` and `TURN_KEY_API_TOKEN`. Without TURN, WebRTC only works when both devices can reach each other via STUN (fails on symmetric NATs). The relay WebSocket is always available as a fallback.

**Auto-update proxy returning 204**: Set `GITHUB_TOKEN` with read access to the repo's releases.

**Clients can't connect**: Verify the relay URL uses `wss://` (not `https://`) in client configs. Check that the worker is deployed and the custom domain (if any) has valid DNS.
