import { useCallback, useSyncExternalStore } from 'react';

export interface Keybinding {
  id: string;
  label: string;
  shortcut: string; // e.g. "Cmd+T", "Cmd+Shift+]"
  category: string;
}

const STORAGE_KEY = 'termpod-keybindings';

export const CATEGORIES = ['Tabs', 'Terminal', 'View', 'App'] as const;

export const DEFAULT_KEYBINDINGS: Keybinding[] = [
  // Tabs
  { id: 'new_tab', label: 'New Tab', shortcut: 'Cmd+T', category: 'Tabs' },
  { id: 'close_tab', label: 'Close Tab', shortcut: 'Cmd+W', category: 'Tabs' },
  { id: 'duplicate_tab', label: 'Duplicate Tab', shortcut: 'Cmd+Shift+T', category: 'Tabs' },
  { id: 'next_tab', label: 'Next Tab', shortcut: 'Cmd+Shift+]', category: 'Tabs' },
  { id: 'prev_tab', label: 'Previous Tab', shortcut: 'Cmd+Shift+[', category: 'Tabs' },
  { id: 'close_other_tabs', label: 'Close Other Tabs', shortcut: 'Cmd+Alt+W', category: 'Tabs' },

  // Terminal
  { id: 'find', label: 'Find', shortcut: 'Cmd+F', category: 'Terminal' },
  { id: 'find_next', label: 'Find Next', shortcut: 'Cmd+G', category: 'Terminal' },
  { id: 'find_prev', label: 'Find Previous', shortcut: 'Cmd+Shift+G', category: 'Terminal' },
  { id: 'clear', label: 'Clear Scrollback', shortcut: 'Cmd+K', category: 'Terminal' },
  { id: 'clear_screen', label: 'Clear Screen', shortcut: 'Cmd+L', category: 'Terminal' },
  { id: 'select_all', label: 'Select All', shortcut: 'Cmd+A', category: 'Terminal' },

  // View
  { id: 'zoom_in', label: 'Zoom In', shortcut: 'Cmd+=', category: 'View' },
  { id: 'zoom_out', label: 'Zoom Out', shortcut: 'Cmd+-', category: 'View' },
  { id: 'zoom_reset', label: 'Reset Zoom', shortcut: 'Cmd+0', category: 'View' },
  { id: 'scroll_top', label: 'Scroll to Top', shortcut: 'Cmd+Up', category: 'View' },
  { id: 'scroll_bottom', label: 'Scroll to Bottom', shortcut: 'Cmd+Down', category: 'View' },

  // App
  { id: 'command_palette', label: 'Command Palette', shortcut: 'Cmd+Shift+P', category: 'App' },
  { id: 'settings', label: 'Settings', shortcut: 'Cmd+,', category: 'App' },
  { id: 'keybindings', label: 'Keyboard Shortcuts', shortcut: 'Cmd+Shift+,', category: 'App' },
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

export function getBindingsByCategory(): Map<string, Keybinding[]> {
  const resolved = getResolvedBindings();
  const map = new Map<string, Keybinding[]>();

  for (const cat of CATEGORIES) {
    map.set(cat, resolved.filter((kb) => kb.category === cat));
  }

  return map;
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
  // Map arrow key names
  if (eventKey === 'arrowup') eventKey = 'up';
  if (eventKey === 'arrowdown') eventKey = 'down';
  if (eventKey === 'arrowleft') eventKey = 'left';
  if (eventKey === 'arrowright') eventKey = 'right';

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
    .replace(/\bUp\b/gi, '↑')
    .replace(/\bDown\b/gi, '↓')
    .replace(/\bLeft\b/gi, '←')
    .replace(/\bRight\b/gi, '→')
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
  if (key === 'ArrowUp') key = 'Up';
  else if (key === 'ArrowDown') key = 'Down';
  else if (key === 'ArrowLeft') key = 'Left';
  else if (key === 'ArrowRight') key = 'Right';
  else if (key.length === 1) key = key.toUpperCase();

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
