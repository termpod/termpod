import { useCallback, useRef, useSyncExternalStore } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';

// asciicast v2 format: https://docs.asciinema.org/manual/asciicast/v2/
// Header: JSON object on first line
// Events: [time, type, data] arrays, one per line

interface AsciicastHeader {
  version: 2;
  width: number;
  height: number;
  timestamp: number;
  title?: string;
  env?: Record<string, string>;
}

type AsciicastEvent = [number, 'o' | 'i', string];

interface RecordingState {
  sessionId: string;
  header: AsciicastHeader;
  events: AsciicastEvent[];
  startTime: number;
}

interface RecordingStore {
  /** Map of sessionId → active recording */
  active: Map<string, RecordingState>;
}

const store: RecordingStore = { active: new Map() };
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) {
    l();
  }
}

function getSnapshot(): RecordingStore {
  return store;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function startRecording(
  sessionId: string,
  cols: number,
  rows: number,
  title?: string,
): void {
  if (store.active.has(sessionId)) {
    return;
  }

  const header: AsciicastHeader = {
    version: 2,
    width: cols,
    height: rows,
    timestamp: Math.floor(Date.now() / 1000),
  };

  if (title) {
    header.title = title;
  }

  store.active.set(sessionId, {
    sessionId,
    header,
    events: [],
    startTime: performance.now(),
  });

  // Create a new store reference to trigger re-render
  store.active = new Map(store.active);
  emit();
}

export function appendOutput(sessionId: string, data: Uint8Array | string): void {
  const recording = store.active.get(sessionId);

  if (!recording) {
    return;
  }

  const elapsed = (performance.now() - recording.startTime) / 1000;
  const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
  recording.events.push([elapsed, 'o', text]);
}

export function isRecording(sessionId: string): boolean {
  return store.active.has(sessionId);
}

export async function stopRecording(sessionId: string): Promise<void> {
  const recording = store.active.get(sessionId);

  if (!recording) {
    return;
  }

  store.active.delete(sessionId);
  store.active = new Map(store.active);
  emit();

  // Build asciicast v2 content
  const lines = [JSON.stringify(recording.header)];

  for (const event of recording.events) {
    lines.push(JSON.stringify(event));
  }

  const content = lines.join('\n') + '\n';

  // Save to file
  const filePath = await save({
    defaultPath: `recording-${sessionId}-${Date.now()}.cast`,
    filters: [{ name: 'asciicast', extensions: ['cast'] }],
  });

  if (filePath) {
    await writeFile(filePath, new TextEncoder().encode(content));
  }
}

export function useRecording() {
  const state = useSyncExternalStore(subscribe, getSnapshot);

  const isSessionRecording = useCallback(
    (sessionId: string) => state.active.has(sessionId),
    [state],
  );

  return {
    isSessionRecording,
    startRecording,
    stopRecording,
    appendOutput,
  };
}
