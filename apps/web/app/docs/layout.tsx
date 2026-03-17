import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import { source } from "@/lib/source";

function Logo() {
  return (
    <span className="inline-flex items-center gap-1.5 font-heading text-base font-bold">
      <span className="text-gold">{">_"}</span>
      <span>
        TERMPOD <span className="font-normal text-text-gray">Docs</span>
      </span>
    </span>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      nav={{
        title: <Logo />,
        url: "/",
      }}
      themeSwitch={{ enabled: false }}
      links={[
        {
          text: "GitHub",
          url: "https://github.com/termpod/termpod",
        },
      ]}
    >
      {children}
    </DocsLayout>
  );
}
