import type { Metadata } from "next";
import { Check, X, Zap } from "lucide-react";
import { Header } from "../components/Header";
import { Footer } from "../components/Footer";

export const metadata: Metadata = {
  title: "Pricing — TermPod",
  description:
    "Local and P2P always free. Relay when you need it. Simple, transparent pricing for developers.",
};

const free = [
  "Local P2P (Bonjour) — unlimited",
  "WebRTC P2P (STUN) — unlimited",
  "1 desktop device",
  "E2E encryption on all transports",
  "Self-hosted relay (everything unlocked)",
  "Open source (MIT)",
];

const pro = [
  "Everything in Free",
  "Relay access (remote viewing)",
  "Unlimited devices",
  "Share links",
  "TURN relay (fallback when P2P fails)",
  "Priority support",
];

const comparison = [
  { feature: "Local P2P (Bonjour)", free: true, pro: true },
  { feature: "WebRTC P2P (STUN)", free: true, pro: true },
  { feature: "E2E encryption", free: true, pro: true },
  { feature: "Open source", free: true, pro: true },
  { feature: "Self-hosted relay", free: true, pro: true },
  { feature: "Relay access", free: false, pro: true },
  { feature: "Devices", free: "1", pro: "Unlimited" },
  { feature: "Share links", free: false, pro: true },
  { feature: "TURN relay", free: false, pro: true },
  { feature: "Priority support", free: false, pro: true },
];

const faqs = [
  {
    question: "What is the relay?",
    answer:
      "When your devices are on the same network, TermPod connects directly via Bonjour or WebRTC — no server involved. The relay is a lightweight Cloudflare Worker that forwards encrypted terminal frames when a direct connection isn't possible (different networks, firewalls, cellular). It never sees your terminal content.",
  },
  {
    question: "Can I self-host the relay?",
    answer:
      "Yes. The relay runs on Cloudflare Workers and fits comfortably within their free tier. Self-hosting unlocks all features — unlimited devices, share links, TURN — at no cost. See the self-hosting guide in our docs.",
  },
  {
    question: "Is my data encrypted?",
    answer:
      "All terminal data is end-to-end encrypted with AES-256-GCM before leaving your device. The relay forwards encrypted frames it cannot decrypt. Local and WebRTC connections are also encrypted. The relay is zero-knowledge by design.",
  },
  {
    question: "What happens after the trial?",
    answer:
      "After 7 days, your account downgrades to the Free plan. You keep full access to local P2P and WebRTC connections — they're always free. You just lose multi-device relay access and share links.",
  },
  {
    question: "Can I cancel anytime?",
    answer:
      "Yes. No contracts, no lock-in. Cancel from your account settings and you'll retain Pro access until the end of your billing period.",
  },
];

function CellValue({ value }: { value: boolean | string }) {
  if (typeof value === "string") {
    return (
      <span className="font-mono text-sm text-text-gray">{value}</span>
    );
  }

  if (value) {
    return <Check size={16} className="text-gold" />;
  }

  return <X size={16} className="text-text-dark" />;
}

export default function PricingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex flex-1 flex-col items-center px-6 py-16 md:py-24">
        {/* Hero */}
        <h1 className="mb-4 text-center font-heading text-4xl font-bold tracking-tight text-text-white md:text-5xl">
          Simple pricing
        </h1>
        <p className="mb-16 max-w-lg text-center font-mono text-sm leading-relaxed text-text-gray">
          Local &amp; P2P always free. Relay when you need it.
        </p>

        {/* Pricing Cards */}
        <div className="mb-24 grid w-full max-w-3xl gap-6 md:grid-cols-2">
          {/* Free */}
          <div className="flex flex-col border border-stroke bg-bg-card p-8">
            <p className="mb-1 font-mono text-xs font-semibold tracking-[0.2em] text-text-gray">
              FREE
            </p>
            <div className="mb-6 flex items-baseline gap-1">
              <span className="font-mono text-4xl font-bold text-text-white">
                $0
              </span>
              <span className="font-mono text-sm text-text-dark">
                / forever
              </span>
            </div>
            <ul className="mb-8 flex flex-1 flex-col gap-3">
              {free.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <Check
                    size={16}
                    className="mt-0.5 shrink-0 text-gold"
                  />
                  <span className="font-mono text-sm text-text-gray">
                    {item}
                  </span>
                </li>
              ))}
            </ul>
            <a
              href="https://github.com/termpod/termpod"
              className="flex items-center justify-center gap-2 border border-stroke px-6 py-3 font-mono text-xs font-semibold tracking-wider text-text-white transition-colors hover:border-text-gray"
            >
              GET STARTED
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
            <p className="mb-1 font-mono text-xs font-semibold tracking-[0.2em] text-gold">
              PRO
            </p>
            <div className="mb-1 flex items-baseline gap-1">
              <span className="font-mono text-4xl font-bold text-text-white">
                $5
              </span>
              <span className="font-mono text-sm text-text-dark">/ month</span>
            </div>
            <p className="mb-6 font-mono text-xs text-text-dark">
              or $50 / year (save 2 months)
            </p>
            <ul className="mb-8 flex flex-1 flex-col gap-3">
              {pro.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <Check
                    size={16}
                    className="mt-0.5 shrink-0 text-gold"
                  />
                  <span className="font-mono text-sm text-text-gray">
                    {item}
                  </span>
                </li>
              ))}
            </ul>
            <a
              href={process.env.NEXT_PUBLIC_POLAR_CHECKOUT_URL ?? "#"}
              className="flex items-center justify-center gap-2 bg-gold px-6 py-3 font-mono text-xs font-semibold tracking-wider text-bg transition-opacity hover:opacity-90"
            >
              START FREE TRIAL
            </a>
          </div>
        </div>

        {/* Feature Comparison */}
        <div className="mb-24 w-full max-w-3xl">
          <h2 className="mb-8 text-center font-heading text-2xl font-bold text-text-white">
            Feature comparison
          </h2>
          <div className="border border-stroke">
            {/* Table header */}
            <div className="grid grid-cols-3 border-b border-stroke bg-bg-card px-6 py-4">
              <span className="font-mono text-xs font-semibold tracking-wider text-text-dark">
                FEATURE
              </span>
              <span className="text-center font-mono text-xs font-semibold tracking-wider text-text-dark">
                FREE
              </span>
              <span className="text-center font-mono text-xs font-semibold tracking-wider text-gold">
                PRO
              </span>
            </div>
            {/* Table rows */}
            {comparison.map((row, i) => (
              <div
                key={row.feature}
                className={`grid grid-cols-3 px-6 py-3.5 ${
                  i < comparison.length - 1 ? "border-b border-stroke/50" : ""
                }`}
              >
                <span className="font-mono text-sm text-text-gray">
                  {row.feature}
                </span>
                <div className="flex items-center justify-center">
                  <CellValue value={row.free} />
                </div>
                <div className="flex items-center justify-center">
                  <CellValue value={row.pro} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div className="w-full max-w-2xl">
          <h2 className="mb-8 text-center font-heading text-2xl font-bold text-text-white">
            Frequently asked questions
          </h2>
          <div className="space-y-6">
            {faqs.map((faq) => (
              <div key={faq.question} className="border-b border-stroke/50 pb-6">
                <h3 className="mb-2 font-heading text-base font-semibold text-text-white">
                  {faq.question}
                </h3>
                <p className="font-mono text-sm leading-relaxed text-text-gray">
                  {faq.answer}
                </p>
              </div>
            ))}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
