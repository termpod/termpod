import { Share2, ListChecks, Circle, Sparkles } from 'lucide-react';
import { SectionHeader } from '../SectionHeader';

function CommandBlockMockup() {
  return (
    <div className="w-full border border-stroke-light bg-[#0D1117]">
      <div className="flex h-8 items-center gap-2 border-b border-stroke-light bg-[#161B22] px-3">
        <span className="h-2.5 w-2.5 rounded-full bg-gold" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#A0A0A0]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#8A8A8A]" />
        <span className="ml-3 font-mono text-[10px] text-text-dark">~/app</span>
      </div>
      <div className="flex flex-col font-mono text-[11px] leading-relaxed">
        {/* Block 1 — success */}
        <div className="border-l-2 border-green-500/40 px-4 py-3">
          <p>
            <span className="text-text-dark">~ $</span>{' '}
            <span className="text-gold">git status</span>
          </p>
          <p className="text-text-gray">On branch main</p>
          <p className="text-text-gray">nothing to commit, working tree clean</p>
          <div className="mt-2 flex items-center gap-2">
            <span className="rounded bg-green-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-green-500">
              0
            </span>
            <span className="text-[9px] text-text-dark hover:text-text-gray cursor-pointer">
              Copy
            </span>
            <span className="text-[9px] text-text-dark hover:text-text-gray cursor-pointer">
              Re-run
            </span>
          </div>
        </div>
        {/* Block 2 — error */}
        <div className="border-l-2 border-red-400/40 px-4 py-3">
          <p>
            <span className="text-text-dark">~ $</span> <span className="text-gold">npm test</span>
          </p>
          <p className="text-text-gray">FAIL src/auth.test.ts</p>
          <p className="text-red-400/80"> Expected: 200, Received: 401</p>
          <div className="mt-2 flex items-center gap-2">
            <span className="rounded bg-red-400/10 px-1.5 py-0.5 text-[9px] font-semibold text-red-400">
              1
            </span>
            <span className="text-[9px] text-text-dark hover:text-text-gray cursor-pointer">
              Copy
            </span>
            <span className="text-[9px] text-text-dark hover:text-text-gray cursor-pointer">
              Re-run
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ShareMockup() {
  return (
    <div className="flex w-full flex-col items-center gap-4 p-6">
      <div className="w-full max-w-[280px] border border-stroke-light bg-[#161B22] p-4">
        <div className="mb-3 flex items-center gap-2">
          <Share2 size={14} className="text-gold" />
          <span className="font-mono text-[11px] font-semibold text-text-white">
            Session Shared
          </span>
        </div>
        <div className="mb-3 flex items-center gap-1 rounded border border-stroke-light bg-[#0D1117] px-2 py-1.5">
          <span className="flex-1 truncate font-mono text-[10px] text-text-dark">
            https://termpod.dev/s/a8f3k2#key=...
          </span>
          <span className="font-mono text-[9px] text-gold">Copied</span>
        </div>
        <div className="flex items-center gap-3 font-mono text-[9px] text-text-dark">
          <span>Read-only</span>
          <span>&middot;</span>
          <span>E2E encrypted</span>
          <span>&middot;</span>
          <span>Expires in 24h</span>
        </div>
      </div>
    </div>
  );
}

export function PowerFeatures() {
  return (
    <section
      id="power-features"
      className="section-alt flex flex-col items-center gap-16 px-6 py-16 md:gap-20 md:px-20 md:py-24 lg:px-[120px] lg:py-[100px]"
    >
      <SectionHeader
        number="02"
        label="POWER FEATURES"
        title="Your shell, with superpowers."
        subtitle="Structure your output, share a live session, save commands you run all the time, and record everything for later."
      />

      {/* Feature 1: Command Blocks */}
      <div className="feature-card flex w-full flex-col overflow-hidden border border-stroke-light md:flex-row">
        <div className="flex flex-1 flex-col justify-center p-8 md:p-12">
          <span className="mb-4 inline-block self-start font-mono text-[11px] font-semibold tracking-[0.2em] text-[#10B981]">
            COMMAND BLOCKS
          </span>
          <h3 className="mb-3 font-heading text-xl font-bold tracking-tight text-text-white md:text-[28px] md:leading-tight">
            Every command, structured
          </h3>
          <p className="font-mono text-sm leading-relaxed text-text-gray">
            TermPod detects where each command starts and ends. You get exit code badges, one-click
            copy, and instant re-run — no more scrolling through a wall of text to find what failed.
            Works with zsh, bash, and fish.
          </p>
        </div>
        <div className="flex flex-1 items-center justify-center bg-[#0A0A0A] p-6 md:max-w-[480px]">
          <CommandBlockMockup />
        </div>
      </div>

      {/* Feature 2: Session Sharing */}
      <div className="feature-card flex w-full flex-col-reverse overflow-hidden border border-stroke-light md:flex-row">
        <div className="flex flex-1 items-center justify-center bg-[#0A0A0A] p-6 md:max-w-[440px]">
          <ShareMockup />
        </div>
        <div className="flex flex-1 flex-col justify-center p-8 md:p-12">
          <span className="mb-4 inline-block self-start font-mono text-[11px] font-semibold tracking-[0.2em] text-gold">
            SESSION SHARING
          </span>
          <h3 className="mb-3 font-heading text-xl font-bold tracking-tight text-text-white md:text-[28px] md:leading-tight">
            Show someone your terminal. Right now.
          </h3>
          <p className="font-mono text-sm leading-relaxed text-text-gray">
            Generate a read-only link and send it to anyone. They watch your session live in a
            browser — no install needed. The encryption key lives in the URL fragment, so the server
            never sees your data. Links expire after 24 hours.
          </p>
        </div>
      </div>

      {/* Secondary cards: Workflows + Recording + Autocomplete */}
      <div className="grid w-full gap-5 md:grid-cols-3">
        <div className="feature-card flex flex-col border border-stroke-light p-8">
          <ListChecks size={24} className="mb-4 text-[#A855F7]" />
          <h4 className="mb-2 font-heading text-base font-bold text-text-white">Workflows</h4>
          <p className="font-mono text-sm leading-relaxed text-text-gray">
            Stop retyping the same deploy scripts and multi-line commands. Save them as workflows,
            run them from the command palette.
          </p>
        </div>
        <div className="feature-card flex flex-col border border-stroke-light p-8">
          <Circle size={24} className="mb-4 text-red-400" />
          <h4 className="mb-2 font-heading text-base font-bold text-text-white">
            Session Recording
          </h4>
          <p className="font-mono text-sm leading-relaxed text-text-gray">
            Hit <code className="text-text-dark">Cmd+Shift+R</code> and every keystroke gets
            captured with millisecond timing. Export as asciicast, play back anytime.
          </p>
        </div>
        <div className="feature-card flex flex-col border border-stroke-light p-8">
          <Sparkles size={24} className="mb-4 text-gold" />
          <h4 className="mb-2 font-heading text-base font-bold text-text-white">Autocompletions</h4>
          <p className="font-mono text-sm leading-relaxed text-text-gray">
            TermPod indexes your shell history and suggests commands as you type. It knows which
            commands take files, which take directories, and ranks by frequency and recency. Works
            over SSH too. Press Tab to accept.
          </p>
        </div>
      </div>
    </section>
  );
}
