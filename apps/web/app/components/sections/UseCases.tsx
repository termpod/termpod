import { SectionHeader } from "../SectionHeader";
import { Screenshot } from "../Screenshot";

function PhoneMockupSmall({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex w-full max-w-[320px] flex-col border-2 border-stroke-light bg-[#0D1117]">
      <div className="flex items-center justify-between border-b border-stroke-light px-4 py-2">
        <span className="font-heading text-xs font-bold tracking-[0.1em] text-text-white">
          {title}
        </span>
        <div className="flex items-center gap-1.5 rounded-full bg-gold-subtle px-2 py-0.5">
          <span className="h-1.5 w-1.5 rounded-full bg-gold" />
          <span className="font-mono text-[8px] font-semibold tracking-wider text-gold">
            LIVE
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-0.5 p-4 font-mono text-[11px] leading-relaxed">
        {children}
      </div>
    </div>
  );
}

export function UseCases() {
  return (
    <section
      id="use-cases"
      className="flex flex-col items-center gap-12 px-6 py-16 md:gap-16 md:px-20 md:py-24 lg:px-[120px] lg:py-[100px]"
    >
      <SectionHeader
        number="02"
        label="USE CASES"
        title="Walk away. Stay in control."
        subtitle="You left something running. Now you need to check on it, respond to a prompt, or approve a deploy. Your phone is already in your pocket."
      />

      {/* UC1 — Walk Away */}
      <div className="flex w-full flex-col overflow-hidden border border-stroke-light md:flex-row">
        <div className="flex flex-1 flex-col justify-center p-8 md:p-12">
          <span className="mb-2 font-heading text-4xl font-bold text-stroke">
            01
          </span>
          <h3 className="mb-3 font-heading text-xl font-bold tracking-tight text-text-white md:text-[26px] md:leading-tight">
            Step away without stopping
          </h3>
          <p className="font-mono text-sm leading-relaxed text-text-gray">
            Long-running builds, database migrations, AI coding agents. Start
            them on your Mac and check progress from your phone while you grab
            coffee, walk the dog, or leave the office.
          </p>
        </div>
        <div className="flex flex-1 items-center justify-center bg-[#0A0A0A] p-6 md:max-w-[440px]">
          <Screenshot src="/screenshots/uc-migrate.png" alt="Database migration progress on iPhone" width={320} height={280}>
          <PhoneMockupSmall title="MIGRATION">
            <p>
              <span className="text-text-dark">$ </span>
              <span className="text-gold">prisma migrate deploy</span>
            </p>
            <p className="text-text-gray">Applying migrations...</p>
            <p className="text-text-gray">&nbsp;</p>
            <p className="text-text-gray">
              <span className="text-green-500">&#10003;</span>{" "}
              20260317_add_users &nbsp;&nbsp;done
            </p>
            <p className="text-text-gray">
              <span className="text-green-500">&#10003;</span>{" "}
              20260317_add_teams &nbsp;&nbsp;done
            </p>
            <p className="text-gold">
              &#9632; 20260317_add_billing &nbsp;67%
            </p>
          </PhoneMockupSmall>
          </Screenshot>
        </div>
      </div>

      {/* UC2 — Approve */}
      <div className="flex w-full flex-col-reverse overflow-hidden border border-stroke-light md:flex-row">
        <div className="flex flex-1 items-center justify-center bg-[#0A0A0A] p-6 md:max-w-[440px]">
          <Screenshot src="/screenshots/uc-deploy.png" alt="Deploy confirmation prompt on iPhone" width={320} height={280}>
          <PhoneMockupSmall title="DEPLOY">
            <p>
              <span className="text-text-dark">$ </span>
              <span className="text-gold">./deploy.sh production</span>
            </p>
            <p className="text-text-gray">&nbsp;</p>
            <p className="text-yellow-400">
              &#9888; Deploy to PRODUCTION?
            </p>
            <p className="text-text-gray">
              This will affect 12,847 active users.
            </p>
            <p className="text-text-gray">&nbsp;</p>
            <p className="text-text-gray">
              Type{" "}
              <span className="text-text-white">&apos;yes&apos;</span> to
              confirm:
              <span className="cursor-blink ml-1 inline-block h-3 w-1.5 bg-gold/80" />
            </p>
          </PhoneMockupSmall>
          </Screenshot>
        </div>
        <div className="flex flex-1 flex-col justify-center p-8 md:p-12">
          <span className="mb-2 font-heading text-4xl font-bold text-stroke">
            02
          </span>
          <h3 className="mb-3 font-heading text-xl font-bold tracking-tight text-text-white md:text-[26px] md:leading-tight">
            Respond to prompts from your phone
          </h3>
          <p className="font-mono text-sm leading-relaxed text-text-gray">
            Deploy confirmations, sudo passwords, Claude Code permission
            requests. Handle interactive prompts from your phone without
            running back to your desk.
          </p>
        </div>
      </div>

      {/* UC3 — Monitor */}
      <div className="flex w-full flex-col overflow-hidden border border-stroke-light md:flex-row">
        <div className="flex flex-1 flex-col justify-center p-8 md:p-12">
          <span className="mb-2 font-heading text-4xl font-bold text-stroke">
            03
          </span>
          <h3 className="mb-3 font-heading text-xl font-bold tracking-tight text-text-white md:text-[22px] md:leading-tight">
            Quick-check server health on the go
          </h3>
          <p className="font-mono text-sm leading-relaxed text-text-gray">
            SSH into your server from your Mac, then check service status, tail
            logs, and run health checks from your phone. No separate SSH app
            needed.
          </p>
        </div>
        <div className="flex flex-1 items-center justify-center bg-[#0A0A0A] p-6">
          <Screenshot src="/screenshots/uc-monitor.png" alt="Server health check terminal" width={480} height={240}>
          <div className="w-full border border-stroke-light bg-[#0D1117]">
            <div className="flex h-7 items-center gap-2 border-b border-stroke-light bg-[#161B22] px-3">
              <span className="h-2 w-2 rounded-full bg-gold" />
              <span className="h-2 w-2 rounded-full bg-[#A0A0A0]" />
              <span className="h-2 w-2 rounded-full bg-[#8A8A8A]" />
              <span className="ml-2 font-mono text-[10px] text-text-dark">
                SERVER
              </span>
            </div>
            <div className="flex flex-col gap-0.5 p-4 font-mono text-[11px] leading-relaxed">
              <p>
                <span className="text-text-dark">root@web $</span>{" "}
                <span className="text-gold">systemctl status nginx</span>
              </p>
              <p className="text-green-500">
                &#9679; nginx.service - active (running)
              </p>
              <p className="text-text-gray">&nbsp;</p>
              <p>
                <span className="text-text-dark">root@web $</span>{" "}
                <span className="text-gold">curl -s localhost/health</span>
              </p>
              <p className="text-text-gray">
                {`{"status":"ok","uptime":"14d","memory":"62%"}`}
              </p>
            </div>
          </div>
          </Screenshot>
        </div>
      </div>
    </section>
  );
}
