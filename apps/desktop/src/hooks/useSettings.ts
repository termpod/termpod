import { useCallback, useRef, useSyncExternalStore } from 'react';

export interface Settings {
  fontSize: number;
  fontFamily: string;
  shellPath: string;
  scrollbackLines: number;
}

const STORAGE_KEY = 'termpod-settings';

const DEFAULTS: Settings = {
  fontSize: 14,
  fontFamily: 'Menlo, monospace',
  shellPath: '/bin/zsh',
  scrollbackLines: 5000,
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (raw) {
      return { ...DEFAULTS, ...JSON.parse(raw) };
    }
  } catch {
    // ignore
  }

  return { ...DEFAULTS };
}

function saveSettings(settings: Settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

const listeners = new Set<() => void>();
let current = loadSettings();

function subscribe(listener: () => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return current;
}

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

export function useSettings() {
  const settings = useSyncExternalStore(subscribe, getSnapshot);

  const update = useCallback((patch: Partial<Settings>) => {
    current = { ...current, ...patch };
    saveSettings(current);
    emit();
  }, []);

  const reset = useCallback(() => {
    current = { ...DEFAULTS };
    saveSettings(current);
    emit();
  }, []);

  return { settings, update, reset, defaults: DEFAULTS };
}
