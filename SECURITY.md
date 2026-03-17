# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in TermPod, please report it responsibly. **Do not open a public GitHub issue.**

Email: **security@termpod.dev**

Please include:

- Description of the vulnerability
- Steps to reproduce
- Affected component (desktop app, relay, iOS app, protocol)
- Impact assessment (if possible)

## Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 1 week
- **Fix or mitigation**: Depends on severity, but we aim for critical fixes within 2 weeks

## Scope

The following are in scope:

- E2E encryption implementation (desktop + iOS)
- Relay server authentication and authorization
- WebSocket protocol security
- JWT handling
- Local transport (Bonjour) authentication
- Share link encryption

## Out of Scope

- Vulnerabilities in third-party dependencies (report these upstream, but let us know)
- Denial of service attacks against the hosted relay
- Social engineering

## Disclosure

We follow coordinated disclosure. We'll work with you on a timeline and credit you in the fix announcement (unless you prefer anonymity).
