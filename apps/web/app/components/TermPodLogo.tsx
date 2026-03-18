export function TermPodIcon({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 115 92"
      width={size}
      height={size * (92 / 115)}
      className={className}
    >
      <path
        fill="currentColor"
        d="M70.712 45.827 9.08 91.654 0 79.474l45.25-33.647L0 12.18 9.08 0zM115 74.818H63.856v15.185H115z"
      />
    </svg>
  );
}
