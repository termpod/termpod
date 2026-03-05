// Detects Claude Code permission prompts in terminal output.
// Claude Code prompts look like:
//   "Do you want to allow Read file.ts?" (Yes/No)
//   "Allow Bash: ls -la?" (Yes/No)
//   "Allow Edit file.ts?" (Yes/No)
//   "Allow Write file.ts?" (Yes/No)

export interface DetectedPrompt {
  type: 'permission';
  tool: string;
  detail: string;
  timestamp: number;
}

// Strip ANSI escape sequences for matching
function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\][^\x07]*\x07/g, '')
    .replace(/\x1b[()][A-Z0-9]/g, '')
    .replace(/\x1b\[[\?]?[0-9;]*[hlm]/g, '');
}

// Patterns that indicate Claude Code is waiting for approval
const PERMISSION_PATTERNS = [
  // "Do you want to allow <Tool> ..."
  /Do you want to allow\s+(\w+)[\s:]+(.+?)[\s?]*\?/i,
  // "Allow <Tool>: <detail>?"
  /Allow\s+(\w+)[\s:]+(.+?)[\s?]*\?/i,
  // Claude Code tool use prompts: "  Tool ─ detail"
  /^\s*(Read|Write|Edit|Bash|Glob|Grep|WebFetch|WebSearch|NotebookEdit)\s+[─-]\s+(.+)/m,
];

// Patterns that indicate the prompt was answered
const RESOLVED_PATTERNS = [
  /Allowed/i,
  /Denied/i,
  /Skipped/i,
];

export class PromptDetector {
  private buffer = '';
  private currentPrompt: DetectedPrompt | null = null;
  private onPrompt: ((prompt: DetectedPrompt | null) => void) | null = null;

  setListener(listener: (prompt: DetectedPrompt | null) => void): void {
    this.onPrompt = listener;
  }

  feed(data: string): void {
    this.buffer += data;

    // Keep buffer manageable
    if (this.buffer.length > 4096) {
      this.buffer = this.buffer.slice(-2048);
    }

    const clean = stripAnsi(this.buffer);

    // Check if current prompt was resolved
    if (this.currentPrompt) {
      for (const pattern of RESOLVED_PATTERNS) {
        if (pattern.test(clean.slice(-200))) {
          this.currentPrompt = null;
          this.onPrompt?.(null);
          this.buffer = '';
          return;
        }
      }
    }

    // Check for new prompts
    for (const pattern of PERMISSION_PATTERNS) {
      const match = clean.match(pattern);

      if (match) {
        const prompt: DetectedPrompt = {
          type: 'permission',
          tool: match[1],
          detail: match[2].trim(),
          timestamp: Date.now(),
        };

        // Avoid firing for the same prompt repeatedly
        if (
          !this.currentPrompt ||
          this.currentPrompt.tool !== prompt.tool ||
          this.currentPrompt.detail !== prompt.detail
        ) {
          this.currentPrompt = prompt;
          this.onPrompt?.(prompt);
        }

        break;
      }
    }
  }

  clear(): void {
    this.buffer = '';
    this.currentPrompt = null;
  }
}
