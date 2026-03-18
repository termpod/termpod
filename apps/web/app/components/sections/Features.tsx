import { Monitor, Smartphone, Shield, Zap, Terminal, ArrowRight, Wifi } from 'lucide-react';
import { SectionHeader } from '../SectionHeader';
import { Screenshot } from '../Screenshot';

function FeatureTag({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="mb-4 inline-block self-start font-mono text-[11px] font-semibold tracking-[0.2em]"
      style={{ color }}
    >
      {label}
    </span>
  );
}

function StreamingTerminal() {
  return (
    <div className="w-full border border-stroke-light bg-[#0D1117]">
      <div className="flex h-8 items-center gap-2 border-b border-stroke-light bg-[#161B22] px-3">
        <span className="h-2.5 w-2.5 rounded-full bg-gold" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#A0A0A0]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#8A8A8A]" />
        <span className="ml-3 font-mono text-[10px] text-text-dark">BUILD</span>
      </div>
      <div className="flex flex-col gap-0.5 p-4 font-mono text-[12px] leading-relaxed">
        <p>
          <span className="text-text-dark">~/app $</span>{' '}
          <span className="text-gold">npm run build</span>
        </p>
        <p className="text-text-gray">Building for production...</p>
        <p className="text-text-gray">
          <span className="text-green-500">&#10003;</span> Compiled 247 modules
        </p>
        <p className="text-text-gray">
          <span className="text-green-500">&#10003;</span> Bundle size: 142kb (gzipped)
        </p>
        <p className="text-text-gray">&nbsp;</p>
        <p>
          <span className="text-text-dark">~/app $</span>{' '}
          <span className="text-gold">npm run deploy</span>
        </p>
        <p className="text-text-gray">Deploying to production...</p>
        <p className="text-text-gray">
          <span className="text-green-500">&#10003;</span> Deployed successfully
        </p>
      </div>
    </div>
  );
}

function LocalFirstVisual() {
  return (
    <div className="flex w-full items-center justify-center gap-4 p-6 md:gap-8 md:p-10">
      {/* Mac */}
      <div className="flex flex-col items-center gap-2">
        <div className="flex h-16 w-20 items-center justify-center border border-stroke-light bg-[#161B22] md:h-20 md:w-24">
          <Monitor size={28} className="text-text-gray" />
        </div>
        <span className="font-mono text-[10px] tracking-wider text-text-dark">MAC</span>
      </div>

      {/* Arrows */}
      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-1">
          <div className="h-px w-6 bg-gold md:w-12" />
          <ArrowRight size={12} className="text-gold" />
        </div>
        <span className="font-mono text-[9px] tracking-wider text-gold">LOCAL</span>
        <span className="font-mono text-[8px] text-text-dark">&lt;5ms</span>
      </div>

      {/* Phone */}
      <div className="flex flex-col items-center gap-2">
        <div className="flex h-16 w-12 items-center justify-center border border-stroke-light bg-[#161B22] md:h-20 md:w-14">
          <Smartphone size={24} className="text-text-gray" />
        </div>
        <span className="font-mono text-[10px] tracking-wider text-text-dark">IPHONE</span>
      </div>
    </div>
  );
}

function SessionListMockup() {
  const sessions = [
    { name: 'prod-server', status: 'live', color: 'bg-gold' },
    { name: 'dev-backend', status: 'live', color: 'bg-green-500' },
    { name: 'staging-api', status: 'idle', color: 'bg-text-dark' },
    { name: 'db-migration', status: 'running', color: 'bg-gold' },
  ];

  return (
    <div className="flex w-full max-w-[320px] flex-col border-2 border-stroke-light bg-[#0D1117]">
      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-1.5">
        <span className="font-mono text-[11px] font-semibold text-text-gray">9:41</span>
        <div className="flex items-center gap-1.5">
          <Wifi size={12} className="text-text-gray" />
          <div className="h-2.5 w-5 rounded-sm border border-text-gray px-px py-px">
            <div className="h-full w-3/4 rounded-xs bg-text-gray" />
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between border-b border-stroke-light px-4 py-2.5">
        <span className="font-heading text-sm font-bold tracking-[0.1em] text-text-white">
          SESSIONS
        </span>
        <span className="font-mono text-[10px] text-text-dark">4 active</span>
      </div>
      <div className="flex flex-col">
        {sessions.map((s) => (
          <div
            key={s.name}
            className="flex items-center gap-3 border-b border-stroke-light/50 px-4 py-3"
          >
            <span className={`h-2 w-2 rounded-full ${s.color}`} />
            <span className="flex-1 font-mono text-[12px] text-text-gray">{s.name}</span>
            <span className="font-mono text-[10px] text-text-dark">{s.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Features() {
  return (
    <section
      id="features"
      className="flex flex-col items-center gap-16 px-6 py-16 md:gap-20 md:px-20 md:py-24 lg:px-[120px] lg:py-[100px]"
    >
      <SectionHeader
        number="01"
        label="FEATURES"
        title="Not a viewer. A full terminal."
        subtitle="Type commands, scroll output, answer prompts. If it runs in your Mac's terminal, it runs through TermPod on your phone."
      />

      {/* Feature 1: Streaming */}
      <div className="flex w-full flex-col overflow-hidden border border-stroke-light md:flex-row">
        <div className="flex flex-1 flex-col justify-center p-8 md:p-12">
          <FeatureTag color="#C9A962" label="REAL-TIME STREAMING" />
          <h3 className="mb-3 font-heading text-xl font-bold tracking-tight text-text-white md:text-[28px] md:leading-tight">
            Every keystroke, in real time
          </h3>
          <p className="font-mono text-sm leading-relaxed text-text-gray">
            Type a command on your phone, see the output instantly on both screens. Scroll through
            history, interact with prompts, run TUI apps. Your phone becomes your terminal.
          </p>
        </div>
        <div className="flex flex-1 items-center justify-center bg-[#0A0A0A] p-6 md:max-w-[520px]">
          <Screenshot
            src="/screenshots/feature-stream.png"
            alt="Real-time terminal streaming"
            width={520}
            height={340}
          >
            <StreamingTerminal />
          </Screenshot>
        </div>
      </div>

      {/* Feature 2: Local First */}
      <div className="flex w-full flex-col-reverse overflow-hidden border border-stroke-light md:flex-row">
        <div className="flex flex-1 items-center justify-center bg-[#0A0A0A] p-6 md:max-w-[480px]">
          <LocalFirstVisual />
        </div>
        <div className="flex flex-1 flex-col justify-center p-8 md:p-12">
          <FeatureTag color="#F59E0B" label="LOCAL-FIRST NETWORKING" />
          <h3 className="mb-3 font-heading text-xl font-bold tracking-tight text-text-white md:text-[28px] md:leading-tight">
            Your data takes the shortest path
          </h3>
          <p className="font-mono text-sm leading-relaxed text-text-gray">
            Same WiFi? Data goes directly between your devices — never leaves the room. Different
            network? TermPod upgrades to peer-to-peer. Your terminal data always takes the fastest,
            most private route.
          </p>
        </div>
      </div>

      {/* Feature 3: Multi Session */}
      <div className="flex w-full flex-col overflow-hidden border border-stroke-light md:flex-row">
        <div className="flex flex-1 flex-col justify-center p-8 md:p-12">
          <FeatureTag color="#A855F7" label="MULTI-SESSION" />
          <h3 className="mb-3 font-heading text-xl font-bold tracking-tight text-text-white md:text-[28px] md:leading-tight">
            All your sessions, one screen
          </h3>
          <p className="mb-6 font-mono text-sm leading-relaxed text-text-gray">
            A build in one tab, logs in another, a deploy script in a third. Each tab is an
            independent shell. Switch between them on your phone just like on your Mac.
          </p>
          <div className="flex flex-wrap gap-6">
            <div>
              <p className="font-heading text-3xl font-bold text-gold md:text-4xl">&lt;5ms</p>
              <p className="font-mono text-[11px] tracking-wider text-text-dark">LOCAL LATENCY</p>
            </div>
            <div>
              <p className="font-heading text-3xl font-bold text-gold md:text-4xl">&infin;</p>
              <p className="font-mono text-[11px] tracking-wider text-text-dark">CONCURRENT TABS</p>
            </div>
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center bg-[#0A0A0A] p-6 md:max-w-[440px]">
          <Screenshot
            src="/screenshots/feature-sessions.png"
            alt="Multiple terminal sessions on iPhone"
            width={320}
            height={400}
          >
            <SessionListMockup />
          </Screenshot>
        </div>
      </div>

      {/* Secondary Feature Cards */}
      <div className="grid w-full gap-5 md:grid-cols-3">
        <div className="flex flex-col border border-stroke-light p-8">
          <Shield size={24} className="mb-4 text-gold" />
          <h4 className="mb-2 font-heading text-base font-bold text-text-white">E2E Encrypted</h4>
          <p className="font-mono text-sm leading-relaxed text-text-gray">
            AES-256-GCM on every transport. The relay is zero-knowledge — it forwards ciphertext it
            cannot read. Nobody sees your terminal data but you.
          </p>
        </div>
        <div className="flex flex-col border border-stroke-light p-8">
          <Zap size={24} className="mb-4 text-[#EC4899]" />
          <h4 className="mb-2 font-heading text-base font-bold text-text-white">Sub-5ms Latency</h4>
          <p className="font-mono text-sm leading-relaxed text-text-gray">
            Local connections are near-instant. Even over peer-to-peer, the overhead is minimal. It
            feels like typing at your desk — because you practically are.
          </p>
        </div>
        <div className="flex flex-col border border-stroke-light p-8">
          <Terminal size={24} className="mb-4 text-gold" />
          <h4 className="mb-2 font-heading text-base font-bold text-text-white">
            Full PTY Support
          </h4>
          <p className="font-mono text-sm leading-relaxed text-text-gray">
            A real pseudoterminal, not a remote framebuffer. vim, htop, Claude Code — if it works in
            your terminal, it works through TermPod.
          </p>
        </div>
      </div>
    </section>
  );
}
