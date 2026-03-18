import type { Metadata } from 'next';
import { Check } from 'lucide-react';
import { Header } from '../../components/Header';
import { Footer } from '../../components/Footer';

export const metadata: Metadata = {
  title: 'Welcome to Pro — TermPod',
  description: 'Your TermPod Pro subscription is active.',
};

const included = [
  'Relay access for remote viewing',
  'Unlimited devices',
  'Session sharing via links',
  'TURN relay for P2P fallback',
  'Priority support',
];

export default function SuccessPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <main className="flex flex-1 flex-col items-center justify-center px-6 py-16 md:py-24">
        <div className="w-full max-w-lg text-center">
          {/* Success icon */}
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center border border-gold/50 bg-gold-subtle">
            <Check size={32} className="text-gold" />
          </div>

          <h1 className="mb-3 font-heading text-3xl font-bold tracking-tight text-text-white md:text-4xl">
            You&apos;re on Pro
          </h1>
          <p className="mb-10 font-mono text-sm leading-relaxed text-text-gray">
            Your subscription is active. Open the TermPod desktop app — relay access and all Pro
            features are now unlocked.
          </p>

          {/* What's included */}
          <div className="mb-10 border border-stroke bg-bg-card p-6 text-left">
            <p className="mb-4 font-mono text-[11px] font-semibold tracking-[0.2em] text-text-dark">
              WHAT&apos;S INCLUDED
            </p>
            <ul className="space-y-3">
              {included.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <Check size={14} className="mt-0.5 shrink-0 text-gold" />
                  <span className="font-mono text-sm text-text-gray">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Actions */}
          <div className="flex flex-col items-center gap-3">
            <a
              href={process.env.NEXT_PUBLIC_POLAR_PORTAL_URL ?? '#'}
              className="font-mono text-xs text-text-dark transition-colors hover:text-text-white"
            >
              Manage subscription
            </a>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
