import { useState, useEffect, useCallback, useRef } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string; notes?: string }
  | { state: 'downloading'; progress: number }
  | { state: 'ready' }
  | { state: 'error'; message: string };

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function useUpdater() {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });
  const [dismissed, setDismissed] = useState(false);
  const pendingUpdate = useRef<Update | null>(null);

  const checkForUpdate = useCallback(async () => {
    try {
      setStatus({ state: 'checking' });
      const update = await check();

      if (!update) {
        setStatus({ state: 'idle' });
        return;
      }

      pendingUpdate.current = update;
      setDismissed(false);
      setStatus({
        state: 'available',
        version: update.version,
        notes: update.body ?? undefined,
      });
    } catch (err) {
      setStatus({ state: 'error', message: String(err) });
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    const update = pendingUpdate.current;

    if (!update) {
      return;
    }

    try {
      let totalLength = 0;
      let downloaded = 0;

      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          totalLength = event.data.contentLength ?? 0;
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          const progress = totalLength > 0 ? downloaded / totalLength : 0;
          setStatus({ state: 'downloading', progress });
        } else if (event.event === 'Finished') {
          setStatus({ state: 'ready' });
        }
      });

      setStatus({ state: 'ready' });
    } catch (err) {
      setStatus({ state: 'error', message: String(err) });
    }
  }, []);

  const installAndRestart = useCallback(async () => {
    await relaunch();
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  // Check on launch + periodically
  useEffect(() => {
    // Delay initial check so the app settles first
    const initialTimeout = setTimeout(checkForUpdate, 5000);
    const interval = setInterval(checkForUpdate, CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [checkForUpdate]);

  return {
    status,
    dismissed,
    checkForUpdate,
    downloadAndInstall,
    installAndRestart,
    dismiss,
  };
}
