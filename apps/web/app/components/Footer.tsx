import { Twitter, Github, Mail } from "lucide-react";

export function Footer() {
  return (
    <footer className="w-full px-6 pt-12 pb-10 md:px-20 lg:px-20">
      {/* Top row */}
      <div className="mb-10 flex flex-col gap-10 md:flex-row md:gap-16">
        {/* Logo + tagline */}
        <div className="max-w-[300px]">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="font-heading text-2xl font-bold text-gold">
              {">_"}
            </span>
            <span className="font-heading text-xl font-bold tracking-[0.15em] text-text-white">
              TERMPOD
            </span>
          </div>
          <p className="font-mono text-sm leading-relaxed text-text-dark">
            Your Mac terminal, in your pocket. Open source, end-to-end
            encrypted, built for developers.
          </p>
        </div>

        {/* Link columns */}
        <div className="grid flex-1 grid-cols-2 gap-8 sm:grid-cols-3">
          <div>
            <p className="mb-4 font-mono text-[11px] font-semibold tracking-[0.2em] text-text-gray">
              PRODUCT
            </p>
            <div className="flex flex-col gap-3">
              <a href="#features" className="font-mono text-sm text-text-dark transition-colors hover:text-text-white">Features</a>
              <a href="/pricing" className="font-mono text-sm text-text-dark transition-colors hover:text-text-white">Pricing</a>
              <a href="#download" className="font-mono text-sm text-text-dark transition-colors hover:text-text-white">Download</a>
              <a href="#use-cases" className="font-mono text-sm text-text-dark transition-colors hover:text-text-white">Use Cases</a>
            </div>
          </div>
          <div>
            <p className="mb-4 font-mono text-[11px] font-semibold tracking-[0.2em] text-text-gray">
              RESOURCES
            </p>
            <div className="flex flex-col gap-3">
              <a href="/docs" className="font-mono text-sm text-text-dark transition-colors hover:text-text-white">Documentation</a>
              <a href="https://github.com/termpod/termpod" className="font-mono text-sm text-text-dark transition-colors hover:text-text-white">GitHub</a>
              <a href="/docs/self-hosting" className="font-mono text-sm text-text-dark transition-colors hover:text-text-white">Self-Hosting Guide</a>
              <a href="/docs/contributing" className="font-mono text-sm text-text-dark transition-colors hover:text-text-white">Contributing</a>
            </div>
          </div>
          <div>
            <p className="mb-4 font-mono text-[11px] font-semibold tracking-[0.2em] text-text-gray">
              LEGAL
            </p>
            <div className="flex flex-col gap-3">
              <a href="/privacy" className="font-mono text-sm text-text-dark transition-colors hover:text-text-white">Privacy Policy</a>
              <a href="https://github.com/termpod/termpod/blob/main/LICENSE" className="font-mono text-sm text-text-dark transition-colors hover:text-text-white">MIT License</a>
            </div>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="mb-6 h-px w-full bg-stroke/50" />

      {/* Bottom row */}
      <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
        <span className="font-mono text-[11px] tracking-wider text-text-dark">
          &copy; 2026 TERMPOD. ALL RIGHTS RESERVED.
        </span>
        <div className="flex items-center gap-4">
          <a href="https://x.com/termpod" className="text-text-dark transition-colors hover:text-text-white"><Twitter size={16} /></a>
          <a href="https://github.com/termpod/termpod" className="text-text-dark transition-colors hover:text-text-white"><Github size={16} /></a>
          <a href="mailto:hello@termpod.dev" className="text-text-dark transition-colors hover:text-text-white"><Mail size={16} /></a>
        </div>
      </div>
    </footer>
  );
}
