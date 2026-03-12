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
    // Get ghost text suggestion
    if (this.options.ghostTextEnabled) {
      const ghostText = this.historyIndex.getGhostText(prefix);
      this.notifyGhostText(ghostText);
    }

    // Get popup suggestions
    if (this.options.popupEnabled) {
      const suggestions = this.historyIndex.getSuggestions(prefix, {
        limit: this.options.maxSuggestions,
      });
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

    return this.historyIndex.getGhostText(this.currentInput.buffer);
  }

  /**
   * Get current suggestions for popup display
   */
  getSuggestions(): Suggestion[] {
    if (!this.options.enabled || !this.options.popupEnabled) {
      return [];
    }

    return this.historyIndex.getSuggestions(this.currentInput.buffer, {
      limit: this.options.maxSuggestions,
    });
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
}
