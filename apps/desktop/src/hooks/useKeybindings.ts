import { useCallback, useSyncExternalStore } from 'react';

export interface Keybinding {
  id: string;
  label: string;
  shortcut: string; // e.g. "Cmd+T", "Cmd+Shift+]"
}

const STORAGE_KEY = 'termpod-keybindings';

export const DEFAULT_KEYBINDINGS: Keybinding[] = [
  { id: 'new_tab', label: 'New Tab', shortcut: 'Cmd+T' },
  { id: 'close_tab', label: 'Close Tab', shortcut: 'Cmd+W' },
  { id: 'next_tab', label: 'Next Tab', shortcut: 'Cmd+Shift+]' },
  { id: 'prev_tab', label: 'Previous Tab', shortcut: 'Cmd+Shift+[' },
  { id: 'find', label: 'Find', shortcut: 'Cmd+F' },
  { id: 'clear', label: 'Clear Scrollback', shortcut: 'Cmd+K' },
  { id: 'settings', label: 'Settings', shortcut: 'Cmd+,' },
];

// Tab shortcuts (Cmd+1 through Cmd+9) are not customizable

export type KeybindingsMap = Record<string, string>; // id → shortcut

function loadCustom(): KeybindingsMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return {};
}

function saveCustom(map: KeybindingsMap) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

const listeners = new Set<() => void>();
let current = loadCustom();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function getSnapshot() {
  return current;
}

function emit() {
  for (const listener of listeners) listener();
}

export function getResolvedBindings(): Keybinding[] {
  const custom = current;
  return DEFAULT_KEYBINDINGS.map((kb) => ({
    ...kb,
    shortcut: custom[kb.id] || kb.shortcut,
  }));
}

/** Parse a shortcut string into a matchable form */
function parseShortcut(shortcut: string): { meta: boolean; ctrl: boolean; shift: boolean; alt: boolean; key: string } {
  const parts = shortcut.split('+');
  const key = parts[parts.length - 1].toLowerCase();
  const mods = parts.slice(0, -1).map((m) => m.toLowerCase());

  return {
    meta: mods.includes('cmd') || mods.includes('meta'),
    ctrl: mods.includes('ctrl'),
    shift: mods.includes('shift'),
    alt: mods.includes('alt') || mods.includes('opt'),
    key,
  };
}

/** Check if a KeyboardEvent matches a shortcut string */
export function matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const parsed = parseShortcut(shortcut);

  // Normalize the event key
  let eventKey = e.key.toLowerCase();
  if (eventKey === '[') eventKey = '[';
  if (eventKey === ']') eventKey = ']';

  return (
    e.metaKey === parsed.meta &&
    e.ctrlKey === parsed.ctrl &&
    e.shiftKey === parsed.shift &&
    e.altKey === parsed.alt &&
    eventKey === parsed.key
  );
}

/** Convert a shortcut string to a display-friendly format */
export function formatShortcut(shortcut: string): string {
  return shortcut
    .replace(/Cmd/gi, '⌘')
    .replace(/Ctrl/gi, '⌃')
    .replace(/Shift/gi, '⇧')
    .replace(/Alt|Opt/gi, '⌥')
    .replace(/\+/g, '');
}

/** Convert a KeyboardEvent into a shortcut string */
export function eventToShortcut(e: KeyboardEvent): string | null {
  // Must have at least one modifier
  if (!e.metaKey && !e.ctrlKey && !e.altKey) return null;
  // Ignore bare modifier keys
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return null;

  const parts: string[] = [];
  if (e.metaKey) parts.push('Cmd');
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  let key = e.key;
  if (key.length === 1) key = key.toUpperCase();

  parts.push(key);
  return parts.join('+');
}

export function useKeybindings() {
  const custom = useSyncExternalStore(subscribe, getSnapshot);

  const resolved = DEFAULT_KEYBINDINGS.map((kb) => ({
    ...kb,
    shortcut: custom[kb.id] || kb.shortcut,
    isCustom: !!custom[kb.id],
  }));

  const updateBinding = useCallback((id: string, shortcut: string) => {
    current = { ...current, [id]: shortcut };
    saveCustom(current);
    emit();
  }, []);

  const resetBinding = useCallback((id: string) => {
    const { [id]: _, ...rest } = current;
    current = rest;
    saveCustom(current);
    emit();
  }, []);

  const resetAll = useCallback(() => {
    current = {};
    saveCustom(current);
    emit();
  }, []);

  return { bindings: resolved, updateBinding, resetBinding, resetAll };
}
