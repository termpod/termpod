# TermPod shell integration for zsh
# Emits OSC 133 semantic prompt markers (FinalTerm / Kitty / Ghostty standard)
# Also provides OSC 134 for autocomplete input capture

# Guard against double-sourcing
(( ${+TERMPOD_SHELL_INTEGRATION} )) && return
builtin typeset -g TERMPOD_SHELL_INTEGRATION=1

# Track whether a command has been executed (controls D marker emission)
builtin typeset -g _termpod_executing=""

# Track current input buffer for autocomplete
builtin typeset -g _termpod_last_buffer=""
builtin typeset -g _termpod_last_cursor=0

# Save exit status FIRST (before any other precmd modifies $?)
_termpod_save_status() {
    builtin typeset -g _termpod_last_status=$?
}

# Emit D (previous command finished) and A (prompt start) markers
_termpod_precmd() {
    # Re-apply widget wrappers in case user startup/plugins rebind widgets.
    _termpod_setup_widgets

    if [[ -n "$_termpod_executing" ]]; then
        builtin printf '\e]133;D;%d\a' "$_termpod_last_status"
    fi
    _termpod_executing=""

    builtin printf '\e]133;A\a'
}

# Append B marker to PS1 (prompt end / input start)
# Runs last so prompt frameworks (Starship, p10k) have already set PS1
_termpod_update_ps1() {
    if [[ "$PS1" != *'133;B'* ]]; then
        PS1="${PS1}%{$(builtin printf '\e]133;B\a')%}"
    fi
}

# Emit C marker (command execution starts / output begins)
_termpod_preexec() {
    builtin printf '\e]133;C\a'
    _termpod_executing=1
}

# Capture input buffer and cursor position for autocomplete
# Uses OSC 134 to send input state to the terminal
_termpod_capture_input() {
    local buffer="$BUFFER"
    local cursor=$CURSOR
    
    # Only emit if buffer changed
    if [[ "$buffer" != "$_termpod_last_buffer" || $cursor -ne $_termpod_last_cursor ]]; then
        _termpod_last_buffer="$buffer"
        _termpod_last_cursor=$cursor
        
        # Base64 encode the buffer to safely transmit special characters
        local encoded=$(builtin printf '%s' "$buffer" | builtin command base64)
        
        builtin printf '\e]134;input;%s;%d\a' "$encoded" "$cursor"
    fi
}

# Wrap an existing widget to add capture after execution
# $1: widget name
_termpod_wrap_widget() {
    local widget_name="$1"
    local wrapped_name="_termpod_wrapped_${widget_name}"
    local orig_alias="_${wrapped_name}_orig"
    local current_widget="${widgets[$widget_name]:-}"

    # Widget must exist.
    [[ -n "$current_widget" ]] || return

    # Already wrapped by us.
    [[ "$current_widget" == "user:${wrapped_name}" ]] && return

    # Always alias the original widget. This works for builtin/user/completion
    # widgets and avoids relying on widgets[$name] string formats.
    zle -A "$widget_name" "$orig_alias" || return

    eval "function $wrapped_name() {
        zle $orig_alias \"\$@\"
        _termpod_capture_input
    }"

    # Install our wrapper
    zle -N "$widget_name" "$wrapped_name"
}

# Setup widget wrappers for input capture
_termpod_setup_widgets() {
    # Wrap the widgets we care about
    _termpod_wrap_widget "self-insert"
    _termpod_wrap_widget "backward-delete-char"
    _termpod_wrap_widget "delete-char"
    _termpod_wrap_widget "accept-line"
    _termpod_wrap_widget "vi-delete-char"
    _termpod_wrap_widget "vi-backward-delete-char"
}

# Call setup immediately
_termpod_setup_widgets

# Capture before executing command
_termpod_preexec_capture() {
    # Clear input state when executing
    _termpod_last_buffer=""
    _termpod_last_cursor=0
    builtin printf '\e]134;execute\a'
    _termpod_preexec
}

# Register hooks:
# - _termpod_save_status FIRST (captures $? before anything else)
# - _termpod_precmd early (emits A, D)
# - _termpod_update_ps1 LAST (appends B after prompt frameworks set PS1)
precmd_functions=(_termpod_save_status _termpod_precmd "${precmd_functions[@]}" _termpod_update_ps1 _termpod_init_syntax_highlighting)
preexec_functions=(_termpod_preexec_capture "${preexec_functions[@]}")

# One-shot: source bundled zsh-syntax-highlighting on first prompt,
# but only if the user doesn't already have it loaded.
_termpod_init_syntax_highlighting() {
    # Remove ourselves — this runs exactly once
    precmd_functions=(${precmd_functions:#_termpod_init_syntax_highlighting})

    # Skip if user already has syntax highlighting active
    # (via oh-my-zsh, zinit, antidote, manual source, etc.)
    (( ${+ZSH_HIGHLIGHT_VERSION} )) && return
    [[ -n "${ZSH_HIGHLIGHT_HIGHLIGHTERS+x}" ]] && return

    # Also skip if fast-syntax-highlighting is loaded
    (( ${+FAST_HIGHLIGHT} )) && return

    # Source our bundled copy
    local bundled="${TERMPOD_SHELL_INTEGRATION_DIR}/zsh-syntax-highlighting/zsh-syntax-highlighting.zsh"
    [[ -f "$bundled" ]] && builtin source "$bundled"
}
