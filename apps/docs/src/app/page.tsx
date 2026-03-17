import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center text-center px-4 py-16">
      <h1 className="text-4xl font-bold mb-4">TermPod</h1>
      <p className="text-fd-muted-foreground text-lg mb-8 max-w-lg">
        Your terminal, everywhere. Start a session on your Mac and pick it up on your iPhone.
      </p>
      <div className="flex gap-4">
        <Link
          href="/docs"
          className="inline-flex items-center gap-2 rounded-lg bg-fd-primary px-6 py-3 text-fd-primary-foreground font-medium hover:bg-fd-primary/90 transition-colors"
        >
          Get Started
        </Link>
        <Link
          href="https://github.com/termpod/termpod"
          className="inline-flex items-center gap-2 rounded-lg border border-fd-border px-6 py-3 font-medium hover:bg-fd-accent transition-colors"
        >
          GitHub
        </Link>
      </div>
    </main>
  );
}
