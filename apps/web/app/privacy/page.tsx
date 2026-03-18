import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy — TermPod',
  description: 'TermPod privacy policy. How we handle your data.',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-heading text-lg font-semibold text-text-white">{title}</h2>
      <div className="space-y-2 font-mono text-sm leading-relaxed text-text-gray">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-6 py-16">
      {/* Header */}
      <Link
        href="/"
        className="mb-12 flex items-center gap-2.5 self-start font-mono text-xs font-semibold tracking-wider text-text-dark transition-colors hover:text-text-white"
      >
        &larr; BACK
      </Link>

      <h1 className="mb-2 font-heading text-3xl font-bold text-text-white">Privacy Policy</h1>
      <p className="mb-12 font-mono text-xs tracking-wider text-text-dark">
        Last updated: March 17, 2026
      </p>

      <div className="space-y-10">
        <Section title="Overview">
          <p>
            TermPod is a shared terminal app. Your privacy and the security of your terminal data
            are fundamental to how we built it. The relay server is zero-knowledge — it cannot read
            your terminal content.
          </p>
        </Section>

        <Section title="End-to-End Encryption">
          <p>
            All terminal data is end-to-end encrypted before leaving your device. The relay server
            forwards encrypted frames it cannot decrypt. We use ECDH P-256 key exchange with
            AES-256-GCM encryption. WebRTC connections use inherent DTLS encryption. Local
            connections use the same ECDH + AES-256-GCM scheme.
          </p>
        </Section>

        <Section title="What We Collect">
          <p>When you create an account, we store:</p>
          <ul className="list-inside list-disc space-y-1 pl-2">
            <li>Your email address (for authentication)</li>
            <li>A hashed password (PBKDF2, never stored in plaintext)</li>
            <li>Device metadata (name, platform) for session routing</li>
          </ul>
          <p>We do not collect, store, or have access to:</p>
          <ul className="list-inside list-disc space-y-1 pl-2">
            <li>Your terminal content (encrypted end-to-end)</li>
            <li>Command history or shell output</li>
            <li>File contents on your machine</li>
            <li>Analytics, telemetry, or usage tracking</li>
          </ul>
        </Section>

        <Section title="Relay Server">
          <p>
            The relay server (Cloudflare Workers + Durable Objects) handles WebSocket routing and
            device presence. It processes only encrypted binary frames and JSON control messages
            (connection metadata, not terminal data). The relay is open source and can be
            self-hosted.
          </p>
        </Section>

        <Section title="Local & P2P Connections">
          <p>
            When your devices are on the same network, TermPod connects directly via Bonjour (local
            WiFi) or WebRTC peer-to-peer. These connections do not route through our servers. Local
            network discovery uses mDNS and requires your explicit permission on iOS.
          </p>
        </Section>

        <Section title="Third-Party Services">
          <p>
            We use Cloudflare for relay hosting and TURN relay (when direct P2P fails).
            Cloudflare&apos;s privacy policy applies to infrastructure-level data (IP addresses,
            connection metadata). No third-party analytics, advertising, or tracking services are
            used.
          </p>
        </Section>

        <Section title="Data Retention">
          <p>
            Account data is retained while your account is active. Terminal data is never stored on
            the relay — it is forwarded in real-time and discarded. You can delete your account at
            any time, which removes all associated data.
          </p>
        </Section>

        <Section title="Open Source">
          <p>
            TermPod is open source under the MIT license. You can audit the encryption
            implementation, relay server, and all client code on{' '}
            <a
              href="https://github.com/termpod/termpod"
              className="text-gold transition-colors hover:text-text-white"
            >
              GitHub
            </a>
            . You can also self-host the relay server for complete control over your data.
          </p>
        </Section>

        <Section title="Changes">
          <p>
            We may update this policy as the product evolves. Significant changes will be
            communicated via the app or our website.
          </p>
        </Section>

        <Section title="Contact">
          <p>
            Questions about privacy? Email{' '}
            <a
              href="mailto:hello@termpod.dev"
              className="text-gold transition-colors hover:text-text-white"
            >
              hello@termpod.dev
            </a>
            .
          </p>
        </Section>
      </div>

      {/* Footer */}
      <div className="mt-16 border-t border-stroke/50 pt-6">
        <span className="font-mono text-[11px] tracking-wider text-text-dark">
          &copy; 2026 TERMPOD. ALL RIGHTS RESERVED.
        </span>
      </div>
    </div>
  );
}
