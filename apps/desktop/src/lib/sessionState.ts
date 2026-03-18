import { join } from '@tauri-apps/api/path';
import { readTextFile, writeTextFile, exists } from '@tauri-apps/plugin-fs';
import { getConfigDir, ensureConfigDir } from './configStore';

export interface SavedTab {
  cwd: string;
}

export interface SavedSessionState {
  tabs: SavedTab[];
  activeIndex: number;
}

const FILENAME = 'sessions.json';
let writeTimer: ReturnType<typeof setTimeout> | null = null;

export async function loadSessionState(): Promise<SavedSessionState | null> {
  try {
    const dir = await getConfigDir();
    const filePath = await join(dir, FILENAME);

    if (!(await exists(filePath))) {
      return null;
    }

    const raw = await readTextFile(filePath);
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) {
      return null;
    }

    return parsed as SavedSessionState;
  } catch {
    return null;
  }
}

export function saveSessionState(state: SavedSessionState): void {
  if (writeTimer) {
    clearTimeout(writeTimer);
  }

  writeTimer = setTimeout(() => writeToDisk(state), 300);
}

export async function saveSessionStateSync(state: SavedSessionState): Promise<void> {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }

  await writeToDisk(state);
}

export function clearSessionState(): void {
  saveSessionState({ tabs: [], activeIndex: 0 });
}

async function writeToDisk(state: SavedSessionState): Promise<void> {
  try {
    await ensureConfigDir();
    const dir = await getConfigDir();
    const filePath = await join(dir, FILENAME);
    await writeTextFile(filePath, JSON.stringify(state, null, 2));
  } catch (err) {
    console.warn('Failed to save session state:', err);
  }
}
