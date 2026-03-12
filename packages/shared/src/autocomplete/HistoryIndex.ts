/**
 * HistoryIndex - Indexes shell history for fast autocomplete suggestions
 *
 * Parses shell history files and maintains an in-memory index
 * with prefix-based lookups for ghost text suggestions.
 */

export interface HistoryEntry {
  command: string;
  timestamp?: number;
  frequency: number; // How often this command has been used
  lastUsed: number;
}

export interface Suggestion {
  text: string;
  type: 'history' | 'file' | 'command';
  description?: string;
  score: number;
}

interface TrieNode {
  children: Map<string, TrieNode>;
  entries: Set<string>; // Command IDs that pass through this node
  isEndOfWord: boolean;
}

export type FileReader = (path: string) => Promise<string>;

export class HistoryIndex {
  private commands: Map<string, HistoryEntry> = new Map();
  private trie: TrieNode = { children: new Map(), entries: new Set(), isEndOfWord: false };
  private maxEntries: number;
  private minCommandLength = 2;
  private fileReader?: FileReader;

  constructor(maxEntries = 10000, fileReader?: FileReader) {
    this.maxEntries = maxEntries;
    this.fileReader = fileReader;
  }

  /**
   * Set the file reader function for loading history files
   */
  setFileReader(reader: FileReader): void {
    this.fileReader = reader;
  }

  /**
   * Load history from a shell history file
   */
  async loadFromFile(historyPath: string): Promise<void> {
    if (!this.fileReader) {
      throw new Error('File reader not set. Call setFileReader() first.');
    }

    try {
      const content = await this.fileReader(historyPath);
      this.parseHistory(content);
    } catch (error) {
      console.warn(`Failed to load history from ${historyPath}:`, error);
      throw error;
    }
  }

  /**
   * Parse shell history content (supports bash, zsh, and fish formats)
   */
  parseHistory(content: string): void {
    const lines = content.split('\n');

    for (const line of lines) {
      const command = this.extractCommand(line);
      if (command && command.length >= this.minCommandLength) {
        this.addCommand(command);
      }
    }
  }

  /**
   * Extract command from a history line
   * Handles formats:
   * - Simple: "git commit -m 'message'"
   * - With timestamp (bash/zsh): ": 1234567890:0;git commit"
   * - Extended (zsh): ": 1234567890:0;git commit"
   */
  private extractCommand(line: string): string | null {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return null;
    }

    // Handle timestamp format: ": timestamp:0;command"
    const timestampMatch = trimmed.match(/^:\s*\d+:\d+;(.+)$/);
    if (timestampMatch) {
      return timestampMatch[1].trim();
    }

    // Handle fish format which may include timestamps differently
    // Fish typically stores: "- cmd: command\n  when: timestamp"
    // But we'll handle the simple case for now

    return trimmed;
  }

  /**
   * Add a command to the index
   */
  addCommand(command: string): void {
    // Normalize: trim whitespace, collapse multiple spaces
    const normalized = command.replace(/\s+/g, ' ').trim();
    if (normalized.length < this.minCommandLength) {
      return;
    }

    const existing = this.commands.get(normalized);
    const now = Date.now();

    if (existing) {
      existing.frequency++;
      existing.lastUsed = now;
    } else {
      this.commands.set(normalized, {
        command: normalized,
        frequency: 1,
        lastUsed: now,
      });

      // Add to trie
      this.addToTrie(normalized);

      // Enforce max entries limit
      this.enforceSizeLimit();
    }
  }

  /**
   * Add command to the trie structure for fast prefix lookup
   */
  private addToTrie(command: string): void {
    let node = this.trie;
    const normalized = command.toLowerCase();

    for (const char of normalized) {
      if (!node.children.has(char)) {
        node.children.set(char, {
          children: new Map(),
          entries: new Set(),
          isEndOfWord: false,
        });
      }
      node = node.children.get(char)!;
      node.entries.add(command);
    }

    node.isEndOfWord = true;
  }

  /**
   * Remove oldest entries when exceeding max size
   */
  private enforceSizeLimit(): void {
    if (this.commands.size <= this.maxEntries) {
      return;
    }

    // Sort by last used (oldest first) and remove 10% of entries
    const sorted = Array.from(this.commands.entries()).sort(
      (a, b) => a[1].lastUsed - b[1].lastUsed,
    );

    const toRemove = Math.floor(this.maxEntries * 0.1);
    for (let i = 0; i < toRemove && i < sorted.length; i++) {
      this.commands.delete(sorted[i][0]);
    }

    // Rebuild trie from remaining commands
    this.rebuildTrie();
  }

  /**
   * Rebuild the entire trie (used after bulk removal)
   */
  private rebuildTrie(): void {
    this.trie = { children: new Map(), entries: new Set(), isEndOfWord: false };
    for (const [command] of this.commands) {
      this.addToTrie(command);
    }
  }

  /**
   * Get autocomplete suggestions for a prefix
   */
  getSuggestions(
    prefix: string,
    options: {
      limit?: number;
      minScore?: number;
    } = {},
  ): Suggestion[] {
    const { limit = 5, minScore = 0 } = options;

    if (prefix.length < this.minCommandLength) {
      return [];
    }

    const normalizedPrefix = prefix.toLowerCase();
    const candidates = this.findCandidates(normalizedPrefix);

    // Score and sort candidates
    const scored = candidates.map((command) => {
      const entry = this.commands.get(command)!;
      const score = this.calculateScore(command, prefix, entry);
      return {
        text: command,
        type: 'history' as const,
        score,
      };
    });

    // Sort by score descending, then by frequency, then by recency
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const entryA = this.commands.get(a.text)!;
      const entryB = this.commands.get(b.text)!;
      if (entryB.frequency !== entryA.frequency) {
        return entryB.frequency - entryA.frequency;
      }
      return entryB.lastUsed - entryA.lastUsed;
    });

    return scored
      .filter((s) => s.score >= minScore)
      .slice(0, limit)
      .map(({ text, type, score }) => ({
        text,
        type,
        score,
      }));
  }

  /**
   * Find all commands matching the given prefix using the trie
   */
  private findCandidates(prefix: string): string[] {
    let node = this.trie;
    const normalizedPrefix = prefix.toLowerCase();

    // Navigate to the node for this prefix
    for (const char of normalizedPrefix) {
      if (!node.children.has(char)) {
        return []; // No commands with this prefix
      }
      node = node.children.get(char)!;
    }

    // Return all commands that pass through this node
    return Array.from(node.entries);
  }

  /**
   * Calculate relevance score for a command
   */
  private calculateScore(command: string, prefix: string, entry: HistoryEntry): number {
    let score = 0;
    const lowerCommand = command.toLowerCase();
    const lowerPrefix = prefix.toLowerCase();

    // Exact prefix match gets highest score
    if (lowerCommand.startsWith(lowerPrefix)) {
      score += 100;
    }
    // Word boundary match (e.g., "gc" matching "git commit")
    else if (lowerCommand.includes(' ' + lowerPrefix)) {
      score += 50;
    }
    // Contains substring
    else if (lowerCommand.includes(lowerPrefix)) {
      score += 25;
    }

    // Boost by frequency (logarithmic to prevent spam from dominating)
    score += Math.log10(entry.frequency + 1) * 10;

    // Boost by recency (commands used in last 24 hours get extra)
    const hoursSinceUse = (Date.now() - entry.lastUsed) / (1000 * 60 * 60);
    if (hoursSinceUse < 24) {
      score += 20;
    } else if (hoursSinceUse < 168) {
      // Within a week
      score += 10;
    }

    // Slight penalty for very long commands
    if (command.length > 100) {
      score -= 5;
    }

    return score;
  }

  /**
   * Get the ghost text suggestion (the single best completion)
   */
  getGhostText(prefix: string): string | null {
    const suggestions = this.getSuggestions(prefix, { limit: 1 });

    if (suggestions.length === 0) {
      return null;
    }

    const suggestion = suggestions[0].text;
    if (suggestion.toLowerCase().startsWith(prefix.toLowerCase())) {
      return suggestion.slice(prefix.length);
    }

    return null;
  }

  /**
   * Clear all history
   */
  clear(): void {
    this.commands.clear();
    this.trie = { children: new Map(), entries: new Set(), isEndOfWord: false };
  }

  /**
   * Get stats about the index
   */
  getStats(): { totalCommands: number; uniqueCommands: number } {
    return {
      totalCommands: Array.from(this.commands.values()).reduce(
        (sum, entry) => sum + entry.frequency,
        0,
      ),
      uniqueCommands: this.commands.size,
    };
  }
}
