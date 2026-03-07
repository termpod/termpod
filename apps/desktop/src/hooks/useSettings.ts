import { useCallback, useSyncExternalStore } from 'react';

export type CursorStyle = 'block' | 'underline' | 'bar';
export type NewTabCwd = 'home' | 'current' | 'custom';
export type BlurStyle = 'none' | 'subtle' | 'medium' | 'full';
export type FontSmoothing = 'auto' | 'antialiased' | 'none';
export type FontWeight = 'normal' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';

export interface TerminalTheme {
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

export const THEMES: Record<string, TerminalTheme> = {
  'tokyo-night': {
    name: 'Tokyo Night',
    background: '#1a1b26',
    foreground: '#c0caf5',
    cursor: '#c0caf5',
    selectionBackground: '#33467c',
    black: '#15161e',
    red: '#f7768e',
    green: '#9ece6a',
    yellow: '#e0af68',
    blue: '#7aa2f7',
    magenta: '#bb9af7',
    cyan: '#7dcfff',
    white: '#a9b1d6',
    brightBlack: '#414868',
    brightRed: '#f7768e',
    brightGreen: '#9ece6a',
    brightYellow: '#e0af68',
    brightBlue: '#7aa2f7',
    brightMagenta: '#bb9af7',
    brightCyan: '#7dcfff',
    brightWhite: '#c0caf5',
  },
  'dracula': {
    name: 'Dracula',
    background: '#282a36',
    foreground: '#f8f8f2',
    cursor: '#f8f8f2',
    selectionBackground: '#44475a',
    black: '#21222c',
    red: '#ff5555',
    green: '#50fa7b',
    yellow: '#f1fa8c',
    blue: '#bd93f9',
    magenta: '#ff79c6',
    cyan: '#8be9fd',
    white: '#f8f8f2',
    brightBlack: '#6272a4',
    brightRed: '#ff6e6e',
    brightGreen: '#69ff94',
    brightYellow: '#ffffa5',
    brightBlue: '#d6acff',
    brightMagenta: '#ff92df',
    brightCyan: '#a4ffff',
    brightWhite: '#ffffff',
  },
  'catppuccin-mocha': {
    name: 'Catppuccin Mocha',
    background: '#1e1e2e',
    foreground: '#cdd6f4',
    cursor: '#f5e0dc',
    selectionBackground: '#45475a',
    black: '#45475a',
    red: '#f38ba8',
    green: '#a6e3a1',
    yellow: '#f9e2af',
    blue: '#89b4fa',
    magenta: '#f5c2e7',
    cyan: '#94e2d5',
    white: '#bac2de',
    brightBlack: '#585b70',
    brightRed: '#f38ba8',
    brightGreen: '#a6e3a1',
    brightYellow: '#f9e2af',
    brightBlue: '#89b4fa',
    brightMagenta: '#f5c2e7',
    brightCyan: '#94e2d5',
    brightWhite: '#a6adc8',
  },
  'github-dark': {
    name: 'GitHub Dark',
    background: '#0d1117',
    foreground: '#c9d1d9',
    cursor: '#c9d1d9',
    selectionBackground: '#264f78',
    black: '#484f58',
    red: '#ff7b72',
    green: '#3fb950',
    yellow: '#d29922',
    blue: '#58a6ff',
    magenta: '#bc8cff',
    cyan: '#39c5cf',
    white: '#b1bac4',
    brightBlack: '#6e7681',
    brightRed: '#ffa198',
    brightGreen: '#56d364',
    brightYellow: '#e3b341',
    brightBlue: '#79c0ff',
    brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd',
    brightWhite: '#f0f6fc',
  },
  'one-dark': {
    name: 'One Dark',
    background: '#282c34',
    foreground: '#abb2bf',
    cursor: '#528bff',
    selectionBackground: '#3e4451',
    black: '#3f4451',
    red: '#e06c75',
    green: '#98c379',
    yellow: '#e5c07b',
    blue: '#61afef',
    magenta: '#c678dd',
    cyan: '#56b6c2',
    white: '#abb2bf',
    brightBlack: '#4f5666',
    brightRed: '#e06c75',
    brightGreen: '#98c379',
    brightYellow: '#e5c07b',
    brightBlue: '#61afef',
    brightMagenta: '#c678dd',
    brightCyan: '#56b6c2',
    brightWhite: '#d7dae0',
  },
  'solarized-dark': {
    name: 'Solarized Dark',
    background: '#002b36',
    foreground: '#839496',
    cursor: '#839496',
    selectionBackground: '#073642',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#586e75',
    brightRed: '#cb4b16',
    brightGreen: '#586e75',
    brightYellow: '#657b83',
    brightBlue: '#839496',
    brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1',
    brightWhite: '#fdf6e3',
  },
  'nord': {
    name: 'Nord',
    background: '#2e3440',
    foreground: '#d8dee9',
    cursor: '#d8dee9',
    selectionBackground: '#434c5e',
    black: '#3b4252',
    red: '#bf616a',
    green: '#a3be8c',
    yellow: '#ebcb8b',
    blue: '#81a1c1',
    magenta: '#b48ead',
    cyan: '#88c0d0',
    white: '#e5e9f0',
    brightBlack: '#4c566a',
    brightRed: '#bf616a',
    brightGreen: '#a3be8c',
    brightYellow: '#ebcb8b',
    brightBlue: '#81a1c1',
    brightMagenta: '#b48ead',
    brightCyan: '#8fbcbb',
    brightWhite: '#eceff4',
  },
  'gruvbox-dark': {
    name: 'Gruvbox Dark',
    background: '#282828',
    foreground: '#ebdbb2',
    cursor: '#ebdbb2',
    selectionBackground: '#504945',
    black: '#282828',
    red: '#cc241d',
    green: '#98971a',
    yellow: '#d79921',
    blue: '#458588',
    magenta: '#b16286',
    cyan: '#689d6a',
    white: '#a89984',
    brightBlack: '#928374',
    brightRed: '#fb4934',
    brightGreen: '#b8bb26',
    brightYellow: '#fabd2f',
    brightBlue: '#83a598',
    brightMagenta: '#d3869b',
    brightCyan: '#8ec07c',
    brightWhite: '#ebdbb2',
  },

  'cobalt2': {
    name: 'Cobalt2',
    background: '#193549',
    foreground: '#ffffff',
    cursor: '#ffc600',
    selectionBackground: '#0050a4',
    black: '#000000',
    red: '#ff0000',
    green: '#38de21',
    yellow: '#ffc600',
    blue: '#1460d2',
    magenta: '#ff005d',
    cyan: '#00bbbb',
    white: '#bbbbbb',
    brightBlack: '#555555',
    brightRed: '#f40e17',
    brightGreen: '#3bd01d',
    brightYellow: '#edc809',
    brightBlue: '#5555ff',
    brightMagenta: '#ff55ff',
    brightCyan: '#6ae3fa',
    brightWhite: '#ffffff',
  },

  // ── Light Themes ──

  'github-light': {
    name: 'GitHub Light',
    background: '#ffffff',
    foreground: '#24292e',
    cursor: '#044289',
    selectionBackground: '#c8c8fa',
    black: '#24292e',
    red: '#d73a49',
    green: '#22863a',
    yellow: '#b08800',
    blue: '#0366d6',
    magenta: '#6f42c1',
    cyan: '#1b7c83',
    white: '#6a737d',
    brightBlack: '#959da5',
    brightRed: '#cb2431',
    brightGreen: '#28a745',
    brightYellow: '#dbab09',
    brightBlue: '#2188ff',
    brightMagenta: '#8a63d2',
    brightCyan: '#3192aa',
    brightWhite: '#d1d5da',
  },
  'catppuccin-latte': {
    name: 'Catppuccin Latte',
    background: '#eff1f5',
    foreground: '#4c4f69',
    cursor: '#dc8a78',
    selectionBackground: '#acb0be',
    black: '#5c5f77',
    red: '#d20f39',
    green: '#40a02b',
    yellow: '#df8e1d',
    blue: '#1e66f5',
    magenta: '#ea76cb',
    cyan: '#179299',
    white: '#acb0be',
    brightBlack: '#6c6f85',
    brightRed: '#d20f39',
    brightGreen: '#40a02b',
    brightYellow: '#df8e1d',
    brightBlue: '#1e66f5',
    brightMagenta: '#ea76cb',
    brightCyan: '#179299',
    brightWhite: '#bcc0cc',
  },
  'solarized-light': {
    name: 'Solarized Light',
    background: '#fdf6e3',
    foreground: '#657b83',
    cursor: '#586e75',
    selectionBackground: '#eee8d5',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#586e75',
    brightRed: '#cb4b16',
    brightGreen: '#586e75',
    brightYellow: '#657b83',
    brightBlue: '#839496',
    brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1',
    brightWhite: '#fdf6e3',
  },
  'one-light': {
    name: 'One Light',
    background: '#fafafa',
    foreground: '#383a42',
    cursor: '#526fff',
    selectionBackground: '#e2e4e9',
    black: '#383a42',
    red: '#e45649',
    green: '#50a14f',
    yellow: '#c18401',
    blue: '#4078f2',
    magenta: '#a626a4',
    cyan: '#0184bc',
    white: '#a0a1a7',
    brightBlack: '#696c77',
    brightRed: '#e45649',
    brightGreen: '#50a14f',
    brightYellow: '#c18401',
    brightBlue: '#4078f2',
    brightMagenta: '#a626a4',
    brightCyan: '#0184bc',
    brightWhite: '#d4d4d4',
  },
  'rose-pine-dawn': {
    name: 'Rose Pine Dawn',
    background: '#faf4ed',
    foreground: '#575279',
    cursor: '#575279',
    selectionBackground: '#dfdad9',
    black: '#575279',
    red: '#b4637a',
    green: '#286983',
    yellow: '#ea9d34',
    blue: '#56949f',
    magenta: '#907aa9',
    cyan: '#d7827e',
    white: '#f2e9e1',
    brightBlack: '#797593',
    brightRed: '#b4637a',
    brightGreen: '#286983',
    brightYellow: '#ea9d34',
    brightBlue: '#56949f',
    brightMagenta: '#907aa9',
    brightCyan: '#d7827e',
    brightWhite: '#faf4ed',
  },
};

// ── Theme → App CSS variables ──

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b]
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('');
}

function adjust(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const a = amount * 255;
  return rgbToHex(r + a, g + a, b + a);
}

function mix(hex1: string, hex2: string, weight: number): string {
  const [r1, g1, b1] = hexToRgb(hex1);
  const [r2, g2, b2] = hexToRgb(hex2);
  const w = weight;
  return rgbToHex(r1 * w + r2 * (1 - w), g1 * w + g2 * (1 - w), b1 * w + b2 * (1 - w));
}

export function isLightColor(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex);
  return (r * 299 + g * 587 + b * 114) / 1000 > 128;
}

function hexToRgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function themeToAppStyles(theme: TerminalTheme, opacity = 1): Record<string, string> {
  const light = isLightColor(theme.background);
  const transparent = opacity < 1;
  const bg = (hex: string) => transparent ? hexToRgba(hex, opacity) : hex;

  return {
    '--bg-primary': bg(theme.background),
    '--bg-secondary': bg(adjust(theme.background, light ? -0.035 : -0.025)),
    '--bg-elevated': bg(adjust(theme.background, light ? -0.015 : 0.035)),
    '--bg-hover': bg(adjust(theme.background, light ? -0.055 : 0.025)),
    '--border': transparent
      ? `rgba(${light ? '0,0,0' : '255,255,255'}, ${light ? 0.1 : 0.08})`
      : adjust(theme.background, light ? -0.11 : 0.09),
    '--border-focus': theme.blue,
    '--text-primary': theme.foreground,
    '--text-secondary': light ? adjust(theme.foreground, 0.15) : theme.white,
    '--text-muted': mix(theme.foreground, theme.background, 0.5),
    '--accent': theme.blue,
    '--accent-hover': theme.brightBlue,
    '--error': theme.red,
    '--success': theme.green,
    '--warning': theme.yellow,
    '--bg-opacity': String(opacity),
    '--terminal-opacity': String(opacity < 1 ? 1 - (1 - opacity) * 0.6 : 1),
  };
}

export interface Settings {
  // Appearance
  theme: string;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  lineHeight: number;
  windowPadding: number;
  backgroundBlur: BlurStyle;
  backgroundOpacity: number;

  // Terminal
  fontSize: number;
  fontFamily: string;
  fontWeight: FontWeight;
  fontSmoothing: FontSmoothing;
  fontLigatures: boolean;
  drawBoldInBold: boolean;
  shellPath: string;
  scrollbackLines: number;
  bellEnabled: boolean;

  // Behavior
  newTabCwd: NewTabCwd;
  customTabCwdPath: string;
  closeWindowOnLastTab: boolean;
  promptAtBottom: boolean;
}

const STORAGE_KEY = 'termpod-settings';

const DEFAULTS: Settings = {
  theme: 'tokyo-night',
  cursorStyle: 'block',
  cursorBlink: true,
  lineHeight: 1.0,
  windowPadding: 0,
  backgroundBlur: 'none',
  backgroundOpacity: 1.0,

  fontSize: 14,
  fontFamily: 'Menlo, monospace',
  fontWeight: 'normal',
  fontSmoothing: 'antialiased',
  fontLigatures: false,
  drawBoldInBold: true,
  shellPath: '/bin/zsh',
  scrollbackLines: 5000,
  bellEnabled: false,

  newTabCwd: 'home',
  customTabCwdPath: '',
  closeWindowOnLastTab: true,
  promptAtBottom: false,
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
