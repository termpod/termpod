/**
 * Emit a custom OSC 135 payload with base64-encoded content.
 */
function oscPayload(tag: string, command: string): string {
  return `printf '\\e]135;${tag};'; (${command}) | base64 | tr -d '\\r\\n'; printf '\\a';`;
}

/**
 * Build a command payload that runs on the remote shell and emits:
 * - OSC 135 "hist"    -> remote history snapshot
 * - OSC 135 "entries" -> current directory entries (ls -1Ap)
 */
export function getRemoteSuggestionsBootstrapPayload(): string {
  const historyCmd = `
{
  history 2>/dev/null | sed -E 's/^[[:space:]]*[0-9]+[[:space:]]+//';
  fc -rl 1 2>/dev/null;
  cat ~/.bash_history ~/.zsh_history 2>/dev/null;
} | sed '/^[[:space:]]*#[[:space:]]*[0-9]\\+[[:space:]]*$/d' | tail -n 1200
`.trim().replace(/\n/g, ' ');

  const entriesCmd = `ls -1Ap 2>/dev/null | head -n 1200`;

  const script = `
${oscPayload('hist', historyCmd)}
${oscPayload('entries', entriesCmd)}
`.trim().split('\n').join(' ');

  // Leading space avoids shell history in common shell configs.
  return ` ${script}\n`;
}

/**
 * Re-fetch remote cwd entries for contextual path suggestions after prompt/cd.
 */
export function getRemoteEntriesRefreshPayload(): string {
  const script = oscPayload('entries', `ls -1Ap 2>/dev/null | head -n 1200`);
  return ` ${script}\n`;
}
