import { Github } from 'lucide-react';
import { TermPodIcon } from './TermPodLogo';

export function Header() {
  return (
    <header className="sticky top-0 z-50 flex w-full items-center justify-between border-b border-stroke-light/20 bg-bg/80 px-6 py-5 backdrop-blur-xl md:px-20">
      {/* Logo */}
      <a href="/" className="flex items-center gap-2.5">
        <TermPodIcon size={22} className="text-gold" />
        <span className="font-heading text-xl font-bold tracking-[0.15em] text-text-white">
          TERMPOD
        </span>
      </a>

      {/* Center nav — hidden on mobile */}
      <nav className="hidden items-center gap-8 lg:flex">
        {[
          ['FEATURES', '#features'],
          ['HOW IT WORKS', '#use-cases'],
          ['PRICING', '/pricing'],
          ['DOCS', '/docs'],
          ['GITHUB', 'https://github.com/termpod/termpod'],
        ].map(([label, href]) => (
          <a
            key={label}
            href={href}
            className="font-mono text-xs font-semibold tracking-wider text-text-gray transition-colors hover:text-text-white"
          >
            {label}
          </a>
        ))}
      </nav>

      {/* Right buttons */}
      <div className="flex items-center gap-3">
        <a
          href="https://github.com/termpod/termpod"
          className="hidden items-center gap-2 border border-stroke-light px-5 py-2.5 font-mono text-xs font-semibold tracking-wider text-text-white transition-colors hover:border-text-gray sm:flex"
        >
          <Github size={14} />
          GITHUB
        </a>
        <a
          href="#download"
          className="hidden items-center gap-2 bg-gold px-6 py-2.5 font-mono text-xs font-semibold tracking-wider text-bg transition-opacity hover:opacity-90 sm:flex"
        >
          DOWNLOAD
        </a>
        {/* Mobile: just github icon */}
        <a
          href="https://github.com/termpod/termpod"
          className="text-text-gray transition-colors hover:text-text-white sm:hidden"
        >
          <Github size={20} />
        </a>
      </div>
    </header>
  );
}
