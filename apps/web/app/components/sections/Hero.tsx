import { Monitor, Smartphone, Wifi, Send } from "lucide-react";
import { Screenshot } from "../Screenshot";

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

function MacTerminal() {
  return (
    <div className="w-full shrink-0 border border-stroke-light bg-[#0D1117]">
      {/* Title bar */}
      <div className="flex h-9 items-center gap-2 border-b border-stroke-light bg-[#161B22] px-4">
        <span className="h-3 w-3 rounded-full bg-gold" />
        <span className="h-3 w-3 rounded-full bg-[#A0A0A0]" />
        <span className="h-3 w-3 rounded-full bg-[#8A8A8A]" />
        <span className="ml-4 font-mono text-[11px] tracking-wider text-text-dark">
          TERMPOD — ZSH
        </span>
      </div>
      {/* Terminal body */}
      <div className="flex flex-col gap-1 p-4 font-mono text-[13px] leading-relaxed md:p-6">
        <p>
          <span className="text-text-dark">~/projects $</span>{" "}
          <span className="text-gold">ssh deploy@prod-server</span>
        </p>
        <p className="text-text-gray">Connected to prod-server (10.0.1.42)</p>
        <p className="text-text-gray">&nbsp;</p>
        <p>
          <span className="text-text-dark">deploy@prod $</span>{" "}
          <span className="text-gold">docker compose up -d</span>
        </p>
        <p className="text-text-gray">
          [+] Running 4/4
        </p>
        <p className="text-text-gray">
          {" "}Container api-server &nbsp;&nbsp;Started
        </p>
        <p className="text-text-gray">
          {" "}Container postgres &nbsp;&nbsp;&nbsp;Started
        </p>
        <p className="text-text-gray">
          {" "}Container redis &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Started
        </p>
        <p className="text-text-gray">
          {" "}Container nginx &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Started
        </p>
        <p className="text-text-gray">&nbsp;</p>
        <p>
          <span className="text-text-dark">deploy@prod $</span>{" "}
          <span className="text-gold">tail -f /var/log/api/access.log</span>
        </p>
        <p className="text-text-gray">
          [2026-03-17 10:23:41] GET /api/health 200 2ms
        </p>
        <p className="text-text-gray">
          [2026-03-17 10:23:42] POST /api/deploy 201 847ms
        </p>
        <p className="flex items-center text-text-gray">
          <span className="cursor-blink inline-block h-4 w-2 bg-gold/80" />
        </p>
      </div>
    </div>
  );
}

function IPhoneMockup() {
  return (
    <div className="flex w-full max-w-[280px] shrink-0 flex-col border-2 border-stroke-light bg-[#0D1117]">
      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-1.5">
        <span className="font-mono text-[11px] font-semibold text-text-gray">
          9:41
        </span>
        <div className="flex items-center gap-1.5">
          <Wifi size={12} className="text-text-gray" />
          <div className="h-2.5 w-5 rounded-sm border border-text-gray px-px py-px">
            <div className="h-full w-3/4 rounded-xs bg-text-gray" />
          </div>
        </div>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between border-b border-stroke-light px-4 py-2.5">
        <span className="font-heading text-sm font-bold tracking-[0.1em] text-text-white">
          TERMPOD
        </span>
        <div className="flex items-center gap-1.5 rounded-full bg-gold-subtle px-2.5 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-gold" />
          <span className="font-mono text-[9px] font-semibold tracking-wider text-gold">
            LIVE
          </span>
        </div>
      </div>

      {/* Session tab */}
      <div className="mx-3 mt-3 flex items-center gap-2 border border-stroke-light bg-[#161B22] px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-gold" />
        <span className="font-mono text-[11px] text-text-gray">
          prod-server
        </span>
      </div>

      {/* Terminal body */}
      <div className="flex flex-1 flex-col gap-0.5 p-3 font-mono text-[11px] leading-relaxed">
        <p>
          <span className="text-text-dark">~ $</span>{" "}
          <span className="text-gold">ssh deploy@prod-server</span>
        </p>
        <p className="text-text-gray">Connected to prod-server</p>
        <p className="text-text-gray">&nbsp;</p>
        <p>
          <span className="text-text-dark">prod $</span>{" "}
          <span className="text-gold">docker compose up -d</span>
        </p>
        <p className="text-text-gray">[+] Running 4/4</p>
        <p className="text-text-gray"> Container api-server Started</p>
        <p className="text-text-gray"> Container postgres &nbsp;Started</p>
        <p className="text-text-gray"> Container redis &nbsp;&nbsp;&nbsp;Started</p>
        <p className="text-text-gray"> Container nginx &nbsp;&nbsp;&nbsp;Started</p>
        <p className="text-text-gray">&nbsp;</p>
        <p>
          <span className="text-text-dark">prod $</span>{" "}
          <span className="text-gold">tail -f /var/log/api/access.log</span>
        </p>
        <p className="text-text-gray">[10:23:41] GET /health 200</p>
      </div>

      {/* Input bar */}
      <div className="flex items-center gap-2 border-t border-stroke-light p-3">
        <div className="flex flex-1 items-center border border-stroke-light bg-[#161B22] px-3 py-1.5">
          <span className="font-mono text-[11px] text-text-dark">
            Type command...
          </span>
        </div>
        <div className="flex h-8 w-8 items-center justify-center bg-gold">
          <Send size={12} className="text-bg" />
        </div>
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section className="flex flex-col items-center px-6 pt-16 pb-16 md:px-20 md:pt-24 md:pb-20 lg:px-[120px] lg:pt-[100px] lg:pb-20">
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
        Start a terminal session on your Mac, pick it up on your iPhone.
        Run Claude Code, monitor a deploy, tail logs. All from your pocket.
        Full shell, real-time I/O, end-to-end encrypted. Open source.
      </p>

      {/* CTA Row */}
      <div className="animate-fade-in-up delay-300 mb-12 flex flex-col items-center gap-4 sm:flex-row sm:gap-4">
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

      {/* Hero Visual */}
      <div className="animate-fade-in-up delay-400 relative mb-10 flex w-full max-w-[900px] flex-col items-center gap-6 md:block">
        {/* Mac terminal — full width of container */}
        <div className="w-full border border-stroke-light p-4 md:p-8">
          <Screenshot src="/screenshots/hero-mac.png" alt="TermPod desktop app showing a terminal session" width={680} height={500}>
            <MacTerminal />
          </Screenshot>
        </div>
        {/* iPhone — overlaps bottom-right on desktop, stacked on mobile */}
        <div className="md:absolute md:right-[-40px] md:bottom-[-40px] md:z-10">
          <div className="shadow-2xl shadow-black/40">
            <Screenshot src="/screenshots/hero-iphone.png" alt="TermPod iOS app viewing the same session" width={280} height={500}>
              <IPhoneMockup />
            </Screenshot>
          </div>
        </div>
      </div>

      {/* Trust Row */}
      <div className="animate-fade-in delay-500 mt-12 flex flex-wrap items-center justify-center gap-5 md:mt-16 md:gap-6">
        <span className="font-mono text-[11px] font-semibold tracking-[0.2em] text-text-dark">
          RUN ANYTHING:
        </span>
        {[
          { name: "Claude Code", icon: <ToolIcon color="#D97757">✦</ToolIcon> },
          { name: "Codex", icon: <ToolIcon color="#10A37F">◈</ToolIcon> },
          { name: "vim", icon: <ToolIcon color="#019833">V</ToolIcon> },
          { name: "htop", icon: <ToolIcon color="#E44D26">H</ToolIcon> },
          { name: "any CLI", icon: <ToolIcon color="#C9A962">&gt;_</ToolIcon> },
        ].map((item, i) => (
          <span key={item.name} className="flex items-center gap-3">
            {i > 0 && (
              <span className="h-1 w-1 rounded-full bg-text-dark" />
            )}
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
