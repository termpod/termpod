/**
 * Termify — inject TermPod shell integration into remote SSH sessions.
 *
 * Writes a compact shell integration script to the PTY so OSC 133 markers
 * are emitted even inside SSH. The script auto-detects zsh or bash and
 * installs the appropriate hooks.
 *
 * Technique:
 *  - Space prefix → avoids shell history
 *  - Script is a single eval-able string (no temp files on remote)
 *  - OSC 133 escapes pass through SSH transparently to local xterm.js
 *  - Ends with `clear` to hide the injected boilerplate
 */

// Compact zsh integration (single-line eval)
const ZSH_INTEGRATION = `
typeset -g TERMPOD_SHELL_INTEGRATION=1 _termpod_executing=""
_termpod_save_status(){ typeset -g _termpod_last_status=$? }
_termpod_precmd(){ [[ -n "$_termpod_executing" ]] && printf '\\e]133;D;%d\\a\\n' "$_termpod_last_status"; _termpod_executing=""; printf '\\e]133;A\\a' }
_termpod_update_ps1(){ [[ "$PS1" != *'133;B'* ]] && PS1="$PS1%{$(printf '\\e]133;B\\a')%}" }
_termpod_preexec(){ printf '\\e]133;C\\a'; _termpod_executing=1 }
precmd_functions=(_termpod_save_status _termpod_precmd "\${precmd_functions[@]}" _termpod_update_ps1)
preexec_functions=(_termpod_preexec "\${preexec_functions[@]}")
`.trim().split('\n').join('; ');

// Compact bash integration (single-line eval)
const BASH_INTEGRATION = `
TERMPOD_SHELL_INTEGRATION=1; _termpod_executing=""; _termpod_in_pc=""
__termpod_prompt_command(){ local ret=$?; _termpod_in_pc=1; if [[ -n "$_termpod_executing" ]]; then printf '\\e]133;D;%d\\a\\n' "$ret"; fi; _termpod_executing=""; printf '\\e]133;A\\a'; [[ "$PS1" != *'133;B'* ]] && PS1="$PS1\\[\\e]133;B\\a\\]"; _termpod_in_pc=""; }
__termpod_debug_trap(){ [[ -n "$_termpod_in_pc" ]] && return; [[ -n "$_termpod_executing" ]] && return; [[ "$BASH_COMMAND" == __termpod_* ]] && return; printf '\\e]133;C\\a'; _termpod_executing=1; }
if [[ -z "$PROMPT_COMMAND" ]]; then PROMPT_COMMAND="__termpod_prompt_command"; elif [[ "$PROMPT_COMMAND" != *"__termpod_prompt_command"* ]]; then PROMPT_COMMAND="__termpod_prompt_command;$PROMPT_COMMAND"; fi
trap '__termpod_debug_trap' DEBUG
`.trim().split('\n').join('; ');

// Auto-detect script: proper single-line (no semicolons after then/do keywords)
const AUTO_DETECT_SCRIPT = `if [ -n "$ZSH_VERSION" ]; then eval '${ZSH_INTEGRATION}'; elif [ -n "$BASH_VERSION" ]; then eval '${BASH_INTEGRATION}'; fi`;

/**
 * Returns the string to write to the PTY to inject shell integration.
 * Uses space prefix to avoid history, then clears the screen.
 */
export function getTermifyPayload(): string {
  // Space prefix avoids history in both bash and zsh (HIST_IGNORE_SPACE)
  return ` ${AUTO_DETECT_SCRIPT}; clear\n`;
}
