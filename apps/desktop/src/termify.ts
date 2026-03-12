/**
 * Termify — inject TermPod shell integration into remote SSH sessions.
 *
 * Writes a shell integration script to the PTY so OSC markers are emitted
 * inside SSH sessions. The script auto-detects zsh or bash and installs the
 * corresponding hooks.
 *
 * Technique:
 *  - Space prefix avoids shell history (HIST_IGNORE_SPACE)
 *  - No remote temp files required
 *  - OSC 133 escapes (prompt markers) and OSC 134 escapes (autocomplete input)
 *    pass through SSH transparently to local xterm.js
 *  - Ends with `clear` to hide the injected boilerplate
 */

// zsh integration: OSC 133 markers + OSC 134 autocomplete input/execute events.
const ZSH_INTEGRATION = `
typeset -g TERMPOD_SHELL_INTEGRATION=1 _termpod_executing=""
typeset -g _termpod_last_buffer="" _termpod_last_cursor=0
_termpod_save_status(){ typeset -g _termpod_last_status=$? }
_termpod_precmd(){ [[ -n "$_termpod_executing" ]] && printf '\\e]133;D;%d\\a' "$_termpod_last_status"; _termpod_executing=""; printf '\\e]133;A\\a' }
_termpod_update_ps1(){ [[ "$PS1" != *'133;B'* ]] && PS1="$PS1%{$(printf '\\e]133;B\\a')%}" }
_termpod_preexec(){ printf '\\e]133;C\\a'; _termpod_executing=1 }
_termpod_capture_input(){ local buffer="$BUFFER" cursor=$CURSOR; if [[ "$buffer" != "$_termpod_last_buffer" || $cursor -ne $_termpod_last_cursor ]]; then _termpod_last_buffer="$buffer"; _termpod_last_cursor=$cursor; local encoded=$(printf '%s' "$buffer" | command base64 | tr -d '\\r\\n'); printf '\\e]134;input;%s;%d\\a' "$encoded" "$cursor"; fi }
_termpod_wrap_widget(){ local widget_name="$1" wrapped_name="_termpod_wrapped_\${widget_name}" orig_alias="_\${wrapped_name}_orig" current_widget="\${widgets[$widget_name]:-}"; [[ -n "$current_widget" ]] || return; [[ "$current_widget" == "user:\${wrapped_name}" ]] && return; zle -A "$widget_name" "$orig_alias" || return; eval "function $wrapped_name() { zle $orig_alias \\"\\$@\\"; _termpod_capture_input; }"; zle -N "$widget_name" "$wrapped_name" }
_termpod_setup_widgets(){ _termpod_wrap_widget "self-insert"; _termpod_wrap_widget "backward-delete-char"; _termpod_wrap_widget "delete-char"; _termpod_wrap_widget "accept-line"; _termpod_wrap_widget "vi-delete-char"; _termpod_wrap_widget "vi-backward-delete-char" }
_termpod_preexec_capture(){ _termpod_last_buffer=""; _termpod_last_cursor=0; printf '\\e]134;execute\\a'; _termpod_preexec }
_termpod_setup_widgets
precmd_functions=(_termpod_save_status _termpod_precmd "\${precmd_functions[@]}" _termpod_update_ps1)
preexec_functions=(_termpod_preexec_capture "\${preexec_functions[@]}")
`.trim();

// bash integration: OSC 133 markers + OSC 134 autocomplete input/execute events.
const BASH_INTEGRATION = `
TERMPOD_SHELL_INTEGRATION=1; _termpod_executing=""; _termpod_in_pc=""
_termpod_last_line=""; _termpod_last_point=0
__termpod_prompt_pre(){ local ret=$?; _termpod_in_pc=1; if [[ -n "$_termpod_executing" ]]; then printf '\\e]133;D;%d\\a' "$ret"; fi; _termpod_executing=""; printf '\\e]133;A\\a'; }
__termpod_prompt_post(){ [[ "$PS1" != *'133;B'* ]] && PS1="$PS1\\[\\e]133;B\\a\\]"; _termpod_in_pc=""; }
__termpod_capture_input(){ if [[ -n "\${READLINE_LINE+x}" ]]; then local line="$READLINE_LINE" point=$READLINE_POINT; if [[ "$line" != "$_termpod_last_line" || $point -ne $_termpod_last_point ]]; then _termpod_last_line="$line"; _termpod_last_point=$point; local encoded=$(printf '%s' "$line" | command base64 | tr -d '\\r\\n'); printf '\\e]134;input;%s;%d\\a' "$encoded" "$point"; fi; fi }
__termpod_debug_trap(){ [[ -n "$_termpod_in_pc" ]] && return; [[ -n "$_termpod_executing" ]] && return; [[ "$BASH_COMMAND" == __termpod_* ]] && return; printf '\\e]133;C\\a'; _termpod_executing=1; _termpod_last_line=""; _termpod_last_point=0; printf '\\e]134;execute\\a'; }
if [[ "\${BASH_VERSINFO[0]}" -ge 4 ]]; then bind -x '"\\C-x\\C-i": __termpod_capture_input' 2>/dev/null || true; bind -x '"\\C-x\\C-h": __termpod_capture_input' 2>/dev/null || true; fi
if [[ -z "$PROMPT_COMMAND" ]]; then PROMPT_COMMAND="__termpod_prompt_pre;__termpod_prompt_post"; elif [[ "$PROMPT_COMMAND" != *"__termpod_prompt_pre"* ]]; then PROMPT_COMMAND="__termpod_prompt_pre;$PROMPT_COMMAND;__termpod_prompt_post"; fi
trap '__termpod_debug_trap' DEBUG
`.trim().split('\n').join('; ');

// Auto-detect script:
// - zsh branch is eval'd from heredoc so bash can parse the whole payload safely.
// - bash branch executes directly.
const AUTO_DETECT_SCRIPT = `
if [ -n "$ZSH_VERSION" ]; then
eval "$(cat <<'__TERMPOD_ZSH__'
${ZSH_INTEGRATION}
__TERMPOD_ZSH__
)"
elif [ -n "$BASH_VERSION" ]; then
${BASH_INTEGRATION}
fi
`.trim();

/**
 * Returns the string to write to the PTY to inject shell integration.
 * Uses space prefix to avoid history, then clears the screen.
 */
export function getTermifyPayload(): string {
  // Space prefix avoids history in both bash and zsh (HIST_IGNORE_SPACE)
  return ` ${AUTO_DETECT_SCRIPT}\nclear\n`;
}
