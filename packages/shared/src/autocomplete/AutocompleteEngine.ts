/**
 * AutocompleteEngine - Main engine for terminal autocomplete
 *
 * Coordinates between shell input (via OSC 134), history index,
 * and suggestion generation. Manages the state of the current
 * input buffer and provides ghost text suggestions.
 */

import { HistoryIndex, Suggestion, FileReader } from './HistoryIndex';

export interface InputState {
  buffer: string;
  cursor: number;
}

export interface AutocompleteOptions {
  enabled?: boolean;
  minPrefixLength?: number;
  maxSuggestions?: number;
  ghostTextEnabled?: boolean;
  popupEnabled?: boolean;
}

export class AutocompleteEngine {
  private historyIndex: HistoryIndex;
  private currentInput: InputState = { buffer: '', cursor: 0 };
  private options: AutocompleteOptions;
  private lastSuggestion: Suggestion | null = null;
  private currentDirectory: string | null = null;
  private listPathEntries?: (path: string) => Promise<string[]>;
  private cachedDirectories: string[] = [];
  private cachedFiles: string[] = [];
  private fsRefreshToken = 0;
  private contextSelectionCounts: Map<string, number> = new Map();
  private onSuggestionCallbacks: Array<(suggestion: string | null) => void> = [];
  private onSuggestionsCallbacks: Array<(suggestions: Suggestion[]) => void> = [];

  constructor(options: AutocompleteOptions = {}, fileReader?: FileReader) {
    this.options = {
      enabled: true,
      minPrefixLength: 2,
      maxSuggestions: 5,
      ghostTextEnabled: true,
      popupEnabled: true,
      ...options,
    };

    this.historyIndex = new HistoryIndex(10000, fileReader);
  }

  /**
   * Get the history index for loading/parsing history
   */
  getHistoryIndex(): HistoryIndex {
    return this.historyIndex;
  }

  /**
   * Set a filesystem entry listing provider for context-aware suggestions.
   * Directory entries should include trailing `/`, file entries should not.
   */
  setPathEntryLister(lister: ((path: string) => Promise<string[]>) | undefined): void {
    this.listPathEntries = lister;
    if (this.currentDirectory) {
      void this.refreshFsCache();
    }
  }

  /**
   * Update current shell working directory (used for contextual suggestions).
   */
  setCurrentDirectory(cwd: string | null | undefined): void {
    const normalized = cwd?.trim() || null;
    if (normalized === this.currentDirectory) {
      return;
    }

    this.currentDirectory = normalized;
    this.cachedDirectories = [];
    this.cachedFiles = [];
    if (this.currentDirectory) {
      void this.refreshFsCache();
    }
  }

  /**
   * Handle input from the shell (OSC 134 sequence)
   * @param buffer Base64 encoded command buffer
   * @param cursor Cursor position in the buffer
   */
  handleInput(buffer: string, cursor: number): void {
    if (!this.options.enabled) {
      return;
    }

    this.currentInput = { buffer, cursor };

    // Only suggest if we're at the end of the buffer
    if (cursor < buffer.length) {
      this.clearSuggestion();
      return;
    }

    // Get prefix (everything before cursor)
    const prefix = buffer.slice(0, cursor);

    if (prefix.length < (this.options.minPrefixLength ?? 2)) {
      this.clearSuggestion();
      return;
    }

    // Opportunistically refresh filesystem cache if needed.
    if (this.currentDirectory && this.listPathEntries && this.cachedDirectories.length === 0) {
      void this.refreshFsCache();
    }

    this.updateSuggestions(prefix);
  }

  /**
   * Handle command execution (clear current state)
   */
  handleExecute(): void {
    // Add the current buffer to history index
    if (this.currentInput.buffer.length >= 2) {
      this.historyIndex.addCommand(this.currentInput.buffer);
    }

    this.currentInput = { buffer: '', cursor: 0 };
    this.clearSuggestion();
  }

  /**
   * Update suggestions based on the current prefix
   */
  private updateSuggestions(prefix: string): void {
    const suggestions = this.computeSuggestions(prefix);

    // Get ghost text suggestion
    if (this.options.ghostTextEnabled) {
      const ghostText =
        suggestions.length > 0 &&
        suggestions[0].text.toLowerCase().startsWith(prefix.toLowerCase())
          ? suggestions[0].text.slice(prefix.length)
          : null;
      this.notifyGhostText(ghostText);
    }

    // Get popup suggestions
    if (this.options.popupEnabled) {
      this.lastSuggestion = suggestions[0] || null;
      this.notifySuggestions(suggestions);
    }
  }

  /**
   * Clear current suggestion
   */
  private clearSuggestion(): void {
    this.lastSuggestion = null;
    this.notifyGhostText(null);
    this.notifySuggestions([]);
  }

  /**
   * Accept the current ghost text suggestion
   * @returns The full command after accepting the suggestion
   */
  acceptSuggestion(): string | null {
    if (!this.lastSuggestion) {
      return null;
    }

    return this.lastSuggestion.text;
  }

  /**
   * Get the current ghost text (suffix to show after cursor)
   */
  getGhostText(): string | null {
    if (!this.options.enabled || !this.options.ghostTextEnabled) {
      return null;
    }

    const prefix = this.currentInput.buffer.slice(0, this.currentInput.cursor);
    const suggestions = this.computeSuggestions(prefix, 1);
    const top = suggestions[0];
    if (!top) {
      return null;
    }

    return top.text.toLowerCase().startsWith(prefix.toLowerCase())
      ? top.text.slice(prefix.length)
      : null;
  }

  /**
   * Get current suggestions for popup display
   */
  getSuggestions(): Suggestion[] {
    if (!this.options.enabled || !this.options.popupEnabled) {
      return [];
    }

    const prefix = this.currentInput.buffer.slice(0, this.currentInput.cursor);
    return this.computeSuggestions(prefix);
  }

  /**
   * Subscribe to ghost text updates
   */
  onGhostText(callback: (suggestion: string | null) => void): () => void {
    this.onSuggestionCallbacks.push(callback);
    return () => {
      const index = this.onSuggestionCallbacks.indexOf(callback);
      if (index > -1) {
        this.onSuggestionCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Subscribe to suggestions updates (for popup)
   */
  onSuggestions(callback: (suggestions: Suggestion[]) => void): () => void {
    this.onSuggestionsCallbacks.push(callback);
    return () => {
      const index = this.onSuggestionsCallbacks.indexOf(callback);
      if (index > -1) {
        this.onSuggestionsCallbacks.splice(index, 1);
      }
    };
  }

  private notifyGhostText(suggestion: string | null): void {
    for (const callback of this.onSuggestionCallbacks) {
      try {
        callback(suggestion);
      } catch (error) {
        console.error('Error in ghost text callback:', error);
      }
    }
  }

  private notifySuggestions(suggestions: Suggestion[]): void {
    for (const callback of this.onSuggestionsCallbacks) {
      try {
        callback(suggestions);
      } catch (error) {
        console.error('Error in suggestions callback:', error);
      }
    }
  }

  /**
   * Update options
   */
  setOptions(options: Partial<AutocompleteOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Get current options
   */
  getOptions(): AutocompleteOptions {
    return { ...this.options };
  }

  /**
   * Enable/disable autocomplete
   */
  setEnabled(enabled: boolean): void {
    this.options.enabled = enabled;
    if (!enabled) {
      this.clearSuggestion();
    }
  }

  /**
   * Load history from file
   */
  async loadHistory(historyPath: string): Promise<void> {
    await this.historyIndex.loadFromFile(historyPath);
  }

  /**
   * Parse history from content string
   */
  parseHistory(content: string): void {
    this.historyIndex.parseHistory(content);
  }

  /**
   * Get stats about the autocomplete engine
   */
  getStats(): { totalCommands: number; uniqueCommands: number } {
    return this.historyIndex.getStats();
  }

  /**
   * Record that a suggestion/command was accepted to improve future ranking.
   */
  recordAcceptedCommand(command: string): void {
    const parsed = this.parseFirstArgCommand(command);
    if (!parsed) return;

    const { cmd, arg } = parsed;
    const key = this.makeContextKey(cmd, arg);
    this.contextSelectionCounts.set(key, (this.contextSelectionCounts.get(key) ?? 0) + 1);
  }

  private async refreshFsCache(): Promise<void> {
    const cwd = this.currentDirectory;
    const lister = this.listPathEntries;

    if (!cwd || !lister) {
      this.cachedDirectories = [];
      this.cachedFiles = [];
      return;
    }

    const token = ++this.fsRefreshToken;

    try {
      const entries = await lister(cwd);
      if (token !== this.fsRefreshToken) {
        return;
      }

      const normalized = Array.from(new Set(entries))
        .map((d) => d.trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

      this.cachedDirectories = normalized
        .filter((entry) => entry.endsWith('/'))
        .map((entry) => entry.slice(0, -1));
      this.cachedFiles = normalized.filter((entry) => !entry.endsWith('/'));
    } catch {
      if (token === this.fsRefreshToken) {
        this.cachedDirectories = [];
        this.cachedFiles = [];
      }
    }
  }

  private computeSuggestions(prefix: string, limit = this.options.maxSuggestions ?? 5): Suggestion[] {
    const historySuggestions = this.historyIndex.getSuggestions(prefix, { limit: limit * 2 });
    const contextSuggestions = this.getContextSuggestions(prefix);
    const merged: Suggestion[] = [];
    const seen = new Set<string>();

    for (const suggestion of [...contextSuggestions, ...historySuggestions]) {
      const key = suggestion.text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(suggestion);
      if (merged.length >= limit) break;
    }

    return merged;
  }

  private getContextSuggestions(prefix: string): Suggestion[] {
    const match = prefix.match(/^\s*([^\s]+)(?:\s+([^\s]*))?\s*$/);
    if (!match) {
      return [];
    }

    const cmd = match[1].toLowerCase();
    const arg = match[2] ?? '';

    // Keep first-argument completion simple and predictable.
    if (arg.startsWith('-')) {
      return [];
    }

    const partial = arg;
    const partialLower = partial.toLowerCase();
    const matchesDirs = this.cachedDirectories.filter((name) =>
      name.toLowerCase().startsWith(partialLower),
    );
    const matchesFiles = this.cachedFiles.filter((name) => name.toLowerCase().startsWith(partialLower));

    const dirOnlyCommands = new Set(['cd', 'pushd', 'popd', 'rmdir', 'mkdir']);
    const fileOrDirCommands = new Set(['ls', 'tree', 'du', 'open', 'code', 'rm', 'cp', 'mv']);
    const fileOnlyCommands = new Set([
      'cat',
      'less',
      'head',
      'tail',
      'bat',
      'vim',
      'nvim',
      'nano',
      'grep',
      'sed',
      'awk',
      'wc',
      'touch',
    ]);

    const out: Suggestion[] = [];

    const pushDirectory = (name: string, index: number) => {
      const usageBoost = this.getContextUsageBoost(cmd, `${name}/`);
      out.push({
        text: `${cmd} ${name}/`,
        type: 'file',
        description: 'Directory',
        score: 220 + usageBoost - index,
      });
    };
    const pushFile = (name: string, index: number) => {
      const usageBoost = this.getContextUsageBoost(cmd, name);
      out.push({
        text: `${cmd} ${name}`,
        type: 'file',
        description: 'File',
        score: 200 + usageBoost - index,
      });
    };

    if (dirOnlyCommands.has(cmd)) {
      matchesDirs.slice(0, 60).forEach(pushDirectory);
      return this.sortContextSuggestions(out);
    }

    if (fileOnlyCommands.has(cmd)) {
      matchesFiles.slice(0, 60).forEach(pushFile);
      return this.sortContextSuggestions(out);
    }

    if (fileOrDirCommands.has(cmd)) {
      matchesDirs.slice(0, 40).forEach(pushDirectory);
      matchesFiles.slice(0, 40).forEach(pushFile);
      return this.sortContextSuggestions(out);
    }

    return [];
  }

  private sortContextSuggestions(suggestions: Suggestion[]): Suggestion[] {
    return suggestions.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.text.localeCompare(b.text, undefined, { sensitivity: 'base' });
    });
  }

  private getContextUsageBoost(cmd: string, arg: string): number {
    const key = this.makeContextKey(cmd, arg);
    const count = this.contextSelectionCounts.get(key) ?? 0;
    // Sublinear boost to avoid hard pinning one choice forever.
    return Math.floor(Math.sqrt(count) * 25);
  }

  private makeContextKey(cmd: string, arg: string): string {
    const normalizedArg = arg.trim().replace(/\/+$/, '').toLowerCase();
    return `${cmd.toLowerCase()}::${normalizedArg}`;
  }

  private parseFirstArgCommand(command: string): { cmd: string; arg: string } | null {
    const trimmed = command.trim();
    if (!trimmed) return null;

    const match = trimmed.match(/^([^\s]+)\s+([^\s]+)/);
    if (!match) return null;

    return { cmd: match[1].toLowerCase(), arg: match[2] };
  }
}
