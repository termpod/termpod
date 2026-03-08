import type { useUpdater } from '../hooks/useUpdater';

type Props = ReturnType<typeof useUpdater>;

export function UpdateBanner({ status, dismissed, downloadAndInstall, installAndRestart, dismiss }: Props) {
  if (dismissed || status.state === 'idle' || status.state === 'checking') {
    return null;
  }

  if (status.state === 'error') {
    return null;
  }

  return (
    <div className="update-banner">
      {status.state === 'available' && (
        <>
          <span className="update-text">
            TermPod <strong>{status.version}</strong> is available.
          </span>
          <button className="update-action" onClick={downloadAndInstall}>
            Download & Install
          </button>
          <button className="update-dismiss" onClick={dismiss} aria-label="Dismiss">
            ×
          </button>
        </>
      )}
      {status.state === 'downloading' && (
        <>
          <span className="update-text">
            Downloading update… {Math.round(status.progress * 100)}%
          </span>
          <div className="update-progress">
            <div className="update-progress-bar" style={{ width: `${status.progress * 100}%` }} />
          </div>
        </>
      )}
      {status.state === 'ready' && (
        <>
          <span className="update-text">
            Update ready. Restart to apply.
          </span>
          <button className="update-action" onClick={installAndRestart}>
            Restart Now
          </button>
          <button className="update-dismiss" onClick={dismiss} aria-label="Dismiss">
            ×
          </button>
        </>
      )}
    </div>
  );
}
