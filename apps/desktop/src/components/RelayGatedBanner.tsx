import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface Props {
  visible: boolean;
}

interface TrialProps {
  visible: boolean;
  daysLeft: number;
}

export function TrialExpiringBanner({ visible, daysLeft }: TrialProps) {
  const [dismissed, setDismissed] = useState(false);

  if (!visible || dismissed) {
    return null;
  }

  return (
    <div className="relay-gated-banner trial-expiring">
      <span className="relay-gated-text">
        Your Pro trial expires in {daysLeft} day{daysLeft !== 1 ? 's' : ''}. Upgrade to keep relay
        access.
      </span>
      <button
        className="relay-gated-link"
        onClick={() => invoke('open_url', { url: 'https://termpod.dev/pricing' })}
      >
        Upgrade
      </button>
      <button
        className="relay-gated-dismiss"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
      >
        &times;
      </button>
    </div>
  );
}

export function RelayGatedBanner({ visible }: Props) {
  const [dismissed, setDismissed] = useState(false);
  const prevVisibleRef = useRef(visible);

  // Reset dismissed state when banner becomes visible again (e.g. plan downgrade)
  useEffect(() => {
    if (visible && !prevVisibleRef.current) {
      setDismissed(false);
    }

    prevVisibleRef.current = visible;
  }, [visible]);

  if (!visible || dismissed) {
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
      <button
        className="relay-gated-dismiss"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
      >
        &times;
      </button>
    </div>
  );
}
