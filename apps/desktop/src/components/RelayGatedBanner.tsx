import { invoke } from '@tauri-apps/api/core';

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
        onClick={() => invoke('open_url', { url: 'https://termpod.dev/pricing' })}
      >
        Upgrade
      </button>
    </div>
  );
}
