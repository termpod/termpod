import { Github, Heart, BookOpen } from 'lucide-react';

export function OpenSource() {
  return (
    <section id="open-source" className="px-6 py-16 md:px-20 md:py-24 lg:px-[120px] lg:py-[100px]">
      <div className="flex flex-col overflow-hidden border border-stroke-light md:flex-row">
        {/* Left */}
        <div className="flex flex-1 flex-col justify-center p-8 md:p-[60px]">
          <div className="mb-4 flex items-center gap-3">
            <Heart size={20} className="text-gold" />
            <span className="font-mono text-[11px] font-semibold tracking-[0.2em] text-gold">
              OPEN SOURCE
            </span>
          </div>
          <h2 className="mb-4 font-heading text-2xl font-bold tracking-tight text-text-white md:text-[32px] md:leading-tight">
            Read every line. Run your own.
          </h2>
          <p className="mb-8 font-mono text-sm leading-relaxed text-text-gray">
            TermPod is MIT licensed. The desktop app, the iOS app, and the relay server are all open
            source. Deploy the relay on Cloudflare Workers free tier and own the entire stack.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <a
              href="https://github.com/termpod/termpod"
              className="flex items-center justify-center gap-2 bg-text-white px-6 py-3 font-mono text-xs font-semibold tracking-wider text-bg transition-opacity hover:opacity-90"
            >
              <Github size={14} />
              VIEW ON GITHUB
            </a>
            <a
              href="/docs/self-hosting"
              className="flex items-center justify-center gap-2 border border-stroke px-6 py-3 font-mono text-xs font-semibold tracking-wider text-text-white transition-colors hover:border-text-gray"
            >
              <BookOpen size={14} />
              DOCUMENTATION
            </a>
          </div>
        </div>

        {/* Right — code block */}
        <div className="flex items-center justify-center bg-[#0A0A0A] p-6 md:max-w-[380px] md:p-10">
          <div className="w-full border border-stroke-light bg-[#0D1117]">
            <div className="flex h-7 items-center gap-2 border-b border-stroke-light bg-[#161B22] px-3">
              <span className="h-2 w-2 rounded-full bg-gold" />
              <span className="h-2 w-2 rounded-full bg-[#A0A0A0]" />
              <span className="h-2 w-2 rounded-full bg-[#8A8A8A]" />
              <span className="ml-2 font-mono text-[10px] text-text-dark">TERMINAL</span>
            </div>
            <div className="flex flex-col gap-1 p-4 font-mono text-[12px] leading-relaxed">
              <p>
                <span className="text-text-dark">$</span>{' '}
                <span className="text-gold">git clone</span>{' '}
                <span className="text-text-gray">termpod/termpod</span>
              </p>
              <p>
                <span className="text-text-dark">$</span> <span className="text-gold">cd</span>{' '}
                <span className="text-text-gray">relay</span>
              </p>
              <p>
                <span className="text-text-dark">$</span>{' '}
                <span className="text-gold">wrangler deploy</span>
              </p>
              <p className="text-text-gray">&nbsp;</p>
              <p className="text-green-500">&#10003; Deployed successfully</p>
              <p className="text-text-gray">relay.your-domain.workers.dev</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
