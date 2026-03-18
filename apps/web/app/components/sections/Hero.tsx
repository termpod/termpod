import { Monitor, Smartphone } from 'lucide-react';
import heroMac from '../../images/hero-mac.png';
import heroIphone from '../../images/hero-iphone.png';

function ToolIcon({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold leading-none"
      style={{ color, backgroundColor: `${color}18` }}
    >
      {children}
    </span>
  );
}

export function Hero() {
  return (
    <section className="relative flex flex-col items-center px-6 pt-16 pb-16 md:px-20 md:pt-24 md:pb-20 lg:px-[120px] lg:pt-[100px] lg:pb-20">
      {/* Atmospheric glow */}
      <div
        className="pointer-events-none absolute top-[-200px] left-1/2 h-[600px] w-[800px] -translate-x-1/2"
        style={{
          background:
            'radial-gradient(ellipse at center, rgba(201,169,98,0.08) 0%, rgba(201,169,98,0.03) 30%, transparent 70%)',
        }}
      />
      {/* Badge */}
      <div className="animate-fade-in mb-12 flex items-center gap-2.5 border border-gold/30 px-4 py-1.5">
        <span className="h-2 w-2 rounded-full bg-gold" />
        <span className="font-mono text-[11px] font-semibold tracking-[0.2em] text-gold">
          OPEN SOURCE
        </span>
      </div>

      {/* Headline */}
      <h1 className="animate-fade-in-up delay-100 mb-6 text-center font-heading text-5xl leading-none font-bold tracking-tight text-text-white md:text-7xl lg:text-[80px]">
        Your terminal,
        <br />
        everywhere.
      </h1>

      {/* Subline */}
      <p className="animate-fade-in-up delay-200 mb-10 max-w-[720px] text-center font-mono text-sm leading-[1.6] text-text-gray md:text-base">
        Start a session on your Mac. Pick it up on your iPhone. Approve a deploy from the couch,
        monitor a build from the coffee shop. Full shell access, real-time I/O, end-to-end
        encrypted. Open source.
      </p>

      {/* CTA Row */}
      <div className="animate-fade-in-up delay-300 mb-12 flex flex-col items-center gap-4 sm:flex-row sm:gap-4">
        <a
          href="#download"
          className="cta-primary flex items-center gap-2.5 bg-gold px-6 py-3 font-mono text-sm font-semibold tracking-wider text-bg"
        >
          <Monitor size={16} />
          DOWNLOAD FOR MAC
        </a>
        <a
          href="#download"
          className="cta-secondary flex items-center gap-2.5 border border-[#555] bg-[#1A1A1A] px-6 py-3 font-mono text-sm font-semibold tracking-wider text-text-white"
        >
          <Smartphone size={16} />
          DOWNLOAD FOR IPHONE
        </a>
      </div>

      {/* Hero Visual */}
      <div className="animate-fade-in-up delay-400 relative mb-10 w-full max-w-[900px]">
        {/* Mac terminal */}
        <img
          src={heroMac.src}
          alt="TermPod desktop app showing a terminal session"
          width={heroMac.width}
          height={heroMac.height}
          className="w-full rounded-lg"
        />
        {/* iPhone — overlaps bottom-right */}
        <img
          src={heroIphone.src}
          alt="TermPod iOS app viewing the same session"
          width={heroIphone.width}
          height={heroIphone.height}
          className="mx-auto mt-6 max-w-[240px] shadow-2xl shadow-black/50 md:absolute md:right-[-120px] md:top-[15%] md:mt-0 md:max-w-[300px]"
        />
      </div>

      {/* Trust Row */}
      <div className="animate-fade-in delay-500 mt-12 flex flex-wrap items-center justify-center gap-5 md:mt-16 md:gap-6">
        <span className="font-mono text-[11px] font-semibold tracking-[0.2em] text-text-dark">
          RUN ANYTHING:
        </span>
        {[
          { name: 'Claude Code', icon: <ToolIcon color="#D97757">✦</ToolIcon> },
          { name: 'Codex', icon: <ToolIcon color="#10A37F">◈</ToolIcon> },
          { name: 'vim', icon: <ToolIcon color="#019833">V</ToolIcon> },
          { name: 'htop', icon: <ToolIcon color="#E44D26">H</ToolIcon> },
          { name: 'any CLI', icon: <ToolIcon color="#C9A962">&gt;_</ToolIcon> },
        ].map((item, i) => (
          <span key={item.name} className="flex items-center gap-3">
            {i > 0 && <span className="h-1 w-1 rounded-full bg-text-dark" />}
            <span className="flex items-center gap-1.5 font-mono text-[11px] tracking-wider text-text-gray">
              {item.icon}
              {item.name}
            </span>
          </span>
        ))}
      </div>
    </section>
  );
}
