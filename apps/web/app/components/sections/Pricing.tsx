import { Check, Zap, Github, Server, Heart } from 'lucide-react';
import { SectionHeader } from '../SectionHeader';

const freeFeatures = [
  'Local WiFi and P2P, no limits',
  'Unlimited sessions and full PTY',
  'E2E encryption on all transports',
  'Self-host relay for full access',
];

const proFeatures = [
  'Everything in Free',
  'Managed cloud relay, zero setup',
  'Unlimited devices on managed relay',
  'Share links and TURN fallback',
  'Priority support',
];

export function Pricing() {
  return (
    <section
      id="pricing"
      className="section-alt flex flex-col items-center gap-12 px-6 py-16 md:gap-16 md:px-20 md:py-24 lg:px-[120px] lg:py-[100px]"
    >
      <SectionHeader
        number="04"
        label="PRICING"
        title="Free to use. Open to self-host."
        subtitle="Local and peer-to-peer connections cost us nothing, so they cost you nothing. Need a cloud relay? Self-host for free or let us run it for $5/mo."
      />

      {/* Pricing Cards */}
      <div className="grid w-full max-w-4xl gap-6 md:grid-cols-2">
        {/* Free */}
        <div className="flex flex-col border border-stroke bg-bg-card p-8">
          <p className="mb-1 font-mono text-xs font-semibold tracking-[0.2em] text-text-gray">
            FREE
          </p>
          <div className="mb-6 flex items-baseline gap-1">
            <span className="font-heading text-5xl font-bold text-text-white">$0</span>
            <span className="font-mono text-sm text-text-dark">/ forever</span>
          </div>
          <ul className="mb-8 flex flex-1 flex-col gap-3">
            {freeFeatures.map((item) => (
              <li key={item} className="flex items-start gap-3">
                <Check size={16} className="mt-0.5 shrink-0 text-gold" />
                <span className="font-mono text-sm text-text-gray">{item}</span>
              </li>
            ))}
          </ul>
          <div className="mb-6 border border-stroke-light bg-bg-inset p-4">
            <p className="font-mono text-[11px] leading-relaxed text-text-dark">
              <span className="text-text-gray">Self-host tip:</span> Deploy your own relay on
              Cloudflare Workers free tier — unlimited devices, share links, everything. No
              subscription needed.
            </p>
          </div>
          <a
            href="https://github.com/termpod/termpod"
            className="cta-secondary flex items-center justify-center gap-2 border border-stroke px-6 py-3 font-mono text-xs font-semibold tracking-wider text-text-white"
          >
            DOWNLOAD FREE
          </a>
        </div>

        {/* Pro */}
        <div className="relative flex flex-col border border-gold/50 bg-bg-card p-8">
          <div className="absolute -top-3 right-6 flex items-center gap-1.5 bg-gold px-3 py-1">
            <Zap size={12} className="text-bg" />
            <span className="font-mono text-[10px] font-semibold tracking-[0.2em] text-bg">
              7-DAY FREE TRIAL
            </span>
          </div>
          <p className="mb-1 font-mono text-xs font-semibold tracking-[0.2em] text-gold">PRO</p>
          <div className="mb-6 flex items-baseline gap-1">
            <span className="font-heading text-5xl font-bold text-text-white">$5</span>
            <span className="font-mono text-sm text-text-dark">/ month</span>
          </div>
          <ul className="mb-8 flex flex-1 flex-col gap-3">
            {proFeatures.map((item) => (
              <li key={item} className="flex items-start gap-3">
                <Check size={16} className="mt-0.5 shrink-0 text-gold" />
                <span className="font-mono text-sm text-text-gray">{item}</span>
              </li>
            ))}
          </ul>
          <div className="mb-6 border border-stroke-light bg-bg-inset p-4">
            <p className="font-mono text-[11px] leading-relaxed text-text-dark">
              <span className="text-text-gray">Support note:</span> Your subscription directly funds
              open-source development and relay infrastructure.
            </p>
          </div>
          <p className="mb-3 text-center font-mono text-[11px] text-text-dark">
            7 days free &middot; no credit card required
          </p>
          <a
            href={process.env.NEXT_PUBLIC_POLAR_CHECKOUT_URL ?? '#'}
            className="cta-primary flex items-center justify-center gap-2 bg-gold px-6 py-3 font-mono text-xs font-semibold tracking-wider text-bg"
          >
            START PRO TRIAL
          </a>
        </div>
      </div>

      {/* Reassurance Row */}
      <div className="flex flex-col items-center gap-6 md:flex-row md:gap-10">
        <div className="flex items-center gap-3">
          <Github size={18} className="text-green-500" />
          <span className="font-mono text-sm text-text-gray">
            Open source &middot; MIT licensed
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Server size={18} className="text-cyan-400" />
          <span className="font-mono text-sm text-text-gray">Self-host for free forever</span>
        </div>
        <div className="flex items-center gap-3">
          <Heart size={18} className="text-orange-400" />
          <span className="font-mono text-sm text-text-gray">Pro supports development</span>
        </div>
      </div>
    </section>
  );
}
