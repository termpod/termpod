import { homeDir, join } from '@tauri-apps/api/path';
import { readTextFile, writeTextFile, mkdir, exists, readDir, watch } from '@tauri-apps/plugin-fs';

const CONFIG_DIR = '.termpod';
let resolvedConfigDir: string | null = null;

export async function getConfigDir(): Promise<string> {
  if (resolvedConfigDir) {
    return resolvedConfigDir;
  }

  const home = await homeDir();
  resolvedConfigDir = await join(home, CONFIG_DIR);

  return resolvedConfigDir;
}

export async function ensureConfigDir(): Promise<string> {
  const dir = await getConfigDir();

  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true });
  }

  const themesDir = await join(dir, 'themes');

  if (!(await exists(themesDir))) {
    await mkdir(themesDir, { recursive: true });
  }

  return dir;
}

export class ConfigStore<T> {
  private current: T;
  private defaults: T;
  private listeners = new Set<() => void>();
  private filename: string;
  private localStorageKey: string;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private writing = false;
  private migrateLegacy?: (raw: string) => string;

  constructor(
    filename: string,
    defaults: T,
    localStorageKey: string,
    options?: { migrateLegacy?: (raw: string) => string },
  ) {
    this.filename = filename;
    this.defaults = defaults;
    this.localStorageKey = localStorageKey;
    this.migrateLegacy = options?.migrateLegacy;

    // Synchronous initial load from localStorage (no flash on first render)
    this.current = this.loadFromLocalStorage();

    // Async: load from file, migrate if needed, start watching
    this.init();
  }

  private loadFromLocalStorage(): T {
    try {
      const raw = localStorage.getItem(this.localStorageKey);

      if (raw) {
        const parsed = JSON.parse(raw);

        if (this.defaults && typeof this.defaults === 'object' && !Array.isArray(this.defaults)) {
          return { ...this.defaults, ...parsed };
        }

        return parsed;
      }
    } catch {
      // ignore
    }

    if (this.defaults && typeof this.defaults === 'object' && !Array.isArray(this.defaults)) {
      return { ...this.defaults };
    }

    return this.defaults;
  }

  private async init(): Promise<void> {
    try {
      const dir = await ensureConfigDir();
      const filePath = await join(dir, this.filename);
      const fileExists = await exists(filePath);

      if (!fileExists) {
        // Migration: localStorage has data, file doesn't exist yet
        const lsRaw = localStorage.getItem(this.localStorageKey);

        if (lsRaw) {
          const toWrite = this.migrateLegacy ? this.migrateLegacy(lsRaw) : lsRaw;
          await writeTextFile(filePath, toWrite);
        } else {
          await writeTextFile(filePath, JSON.stringify(this.defaults, null, 2));
        }
      }

      // Load from file (may differ from localStorage if user edited it)
      await this.loadFromFile(filePath);

      // Clear localStorage after successful migration
      localStorage.removeItem(this.localStorageKey);

      // Watch for external changes
      await watch(
        filePath,
        async () => {
          if (this.writing) {
            return;
          }

          await this.loadFromFile(filePath);
        },
        { delayMs: 300 },
      );
    } catch (err) {
      console.warn(`ConfigStore(${this.filename}): init failed, using in-memory state`, err);
    }
  }

  private async loadFromFile(filePath: string): Promise<void> {
    try {
      const raw = await readTextFile(filePath);
      const parsed = JSON.parse(raw);

      let merged: T;

      if (this.defaults && typeof this.defaults === 'object' && !Array.isArray(this.defaults)) {
        merged = { ...this.defaults, ...parsed };
      } else {
        merged = parsed;
      }

      if (JSON.stringify(merged) !== JSON.stringify(this.current)) {
        this.current = merged;
        this.emit();
      }
    } catch {
      console.warn(`ConfigStore(${this.filename}): failed to read file, keeping current state`);
    }
  }

  getSnapshot = (): T => this.current;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);

    return () => {
      this.listeners.delete(listener);
    };
  };

  update(patch: Partial<T>): void {
    this.current = { ...this.current, ...patch } as T;
    this.emit();
    this.scheduleDiskWrite();
  }

  replace(value: T): void {
    this.current = value;
    this.emit();
    this.scheduleDiskWrite();
  }

  reset(): void {
    if (this.defaults && typeof this.defaults === 'object' && !Array.isArray(this.defaults)) {
      this.current = { ...this.defaults };
    } else {
      this.current = this.defaults;
    }

    this.emit();
    this.scheduleDiskWrite();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private scheduleDiskWrite(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
    }

    this.writeTimer = setTimeout(() => this.writeToDisk(), 500);
  }

  private async writeToDisk(): Promise<void> {
    this.writing = true;

    try {
      const dir = await getConfigDir();
      const filePath = await join(dir, this.filename);
      await writeTextFile(filePath, JSON.stringify(this.current, null, 2));
    } catch (err) {
      console.error(`ConfigStore(${this.filename}): failed to write`, err);
    } finally {
      setTimeout(() => {
        this.writing = false;
      }, 200);
    }
  }
}

// ── Custom Themes ──

export interface CustomThemeFile {
  name: string;
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

const REQUIRED_THEME_KEYS: (keyof CustomThemeFile)[] = [
  'name',
  'background',
  'foreground',
  'cursor',
  'selectionBackground',
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
];

function isValidTheme(obj: unknown): obj is CustomThemeFile {
  if (!obj || typeof obj !== 'object') {
    return false;
  }

  return REQUIRED_THEME_KEYS.every((k) => typeof (obj as Record<string, unknown>)[k] === 'string');
}

type CustomThemeMap = Record<string, CustomThemeFile>;

let customThemes: CustomThemeMap = {};
const customThemeListeners = new Set<() => void>();

function emitCustomThemes(): void {
  for (const listener of customThemeListeners) {
    listener();
  }
}

export function getCustomThemesSnapshot(): CustomThemeMap {
  return customThemes;
}

export function subscribeCustomThemes(listener: () => void): () => void {
  customThemeListeners.add(listener);

  return () => {
    customThemeListeners.delete(listener);
  };
}

async function loadThemesFromDir(themesDir: string): Promise<void> {
  try {
    const entries = await readDir(themesDir);
    const next: CustomThemeMap = {};

    for (const entry of entries) {
      if (!entry.name?.endsWith('.json') || entry.isDirectory) {
        continue;
      }

      try {
        const filePath = await join(themesDir, entry.name);
        const raw = await readTextFile(filePath);
        const parsed = JSON.parse(raw);

        if (isValidTheme(parsed)) {
          const key = `custom:${entry.name.replace(/\.json$/, '')}`;
          next[key] = parsed;
        }
      } catch {
        // skip invalid files
      }
    }

    if (JSON.stringify(next) !== JSON.stringify(customThemes)) {
      customThemes = next;
      emitCustomThemes();
    }
  } catch {
    // themes dir might not exist yet
  }
}

export async function initCustomThemes(): Promise<void> {
  try {
    const dir = await ensureConfigDir();
    const themesDir = await join(dir, 'themes');

    await loadThemesFromDir(themesDir);

    await watch(
      themesDir,
      async () => {
        await loadThemesFromDir(themesDir);
      },
      { delayMs: 500, recursive: false },
    );
  } catch (err) {
    console.warn('Failed to init custom themes:', err);
  }
}
