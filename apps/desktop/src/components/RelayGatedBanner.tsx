interface Props {
  visible: boolean;
}

export function RelayGatedBanner({ visible }: Props) {
  if (!visible) {
    return null;
  }

  return (
    <div className="relay-gated-banner">
      <span className="relay-gated-text">
        Remote access via relay requires Pro. Local and P2P connections still work.
      </span>
      <a
        className="relay-gated-link"
        href="https://termpod.dev/#pricing"
        target="_blank"
        rel="noopener noreferrer"
      >
        Upgrade
      </a>
    </div>
  );
}
