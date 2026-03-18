import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';
import { source } from '@/lib/source';
import { TermPodIcon } from '../components/TermPodLogo';

function Logo() {
  return (
    <span className="inline-flex items-center gap-1.5 font-heading text-base font-bold">
      <TermPodIcon size={16} className="text-gold" />
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
        url: '/',
      }}
      themeSwitch={{ enabled: false }}
      links={[
        {
          text: 'GitHub',
          url: 'https://github.com/termpod/termpod',
        },
      ]}
    >
      {children}
    </DocsLayout>
  );
}
