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
      <button
        className="relay-gated-link"
        onClick={() => window.open('https://termpod.dev/pricing', '_blank')}
      >
        Upgrade
      </button>
    </div>
  );
}
