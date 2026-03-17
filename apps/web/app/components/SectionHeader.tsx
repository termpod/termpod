export function SectionHeader({
  number,
  label,
  title,
  subtitle,
}: {
  number: string;
  label: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <span className="font-mono text-[11px] font-semibold tracking-[0.2em] text-gold">
        {number} — {label}
      </span>
      <h2 className="max-w-3xl font-heading text-3xl font-bold tracking-tight text-text-white md:text-[48px] md:leading-[1.1]">
        {title}
      </h2>
      <p className="max-w-[600px] font-mono text-sm leading-relaxed text-text-gray">
        {subtitle}
      </p>
    </div>
  );
}
