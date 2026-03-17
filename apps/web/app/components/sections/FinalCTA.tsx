import { Monitor, Smartphone } from "lucide-react";

export function FinalCTA() {
  return (
    <section
      id="download"
      className="px-6 py-16 md:px-20 md:py-24 lg:px-[120px] lg:py-[100px]"
    >
      <div
        className="flex flex-col items-center border border-gold-dim p-10 text-center md:p-16"
        style={{
          background:
            "linear-gradient(to bottom, rgba(201,169,98,0.06) 0%, transparent 100%)",
        }}
      >
        <h2 className="mb-4 font-heading text-3xl font-bold tracking-tight text-text-white md:text-[48px] md:leading-tight">
          Your terminal, untethered.
        </h2>
        <p className="mb-10 max-w-[600px] font-mono text-sm leading-relaxed text-text-gray">
          Stop context-switching between devices. Start a session on your Mac
          and take it with you — local, P2P, or relay. Your choice.
        </p>
        <div className="mb-6 flex flex-col items-center gap-4 sm:flex-row">
          <a
            href="#download"
            className="flex items-center gap-2.5 bg-gold px-6 py-3 font-mono text-sm font-semibold tracking-wider text-bg transition-opacity hover:opacity-90"
          >
            <Monitor size={16} />
            DOWNLOAD FOR MAC
          </a>
          <a
            href="#download"
            className="flex items-center gap-2.5 border border-[#555] bg-[#1A1A1A] px-6 py-3 font-mono text-sm font-semibold tracking-wider text-text-white transition-colors hover:border-text-gray"
          >
            <Smartphone size={16} />
            DOWNLOAD FOR IPHONE
          </a>
        </div>
        <p className="font-mono text-[11px] tracking-wider text-text-dark">
          Open source &middot; Free for local use &middot; Self-host or go Pro
        </p>
      </div>
    </section>
  );
}
