#!/bin/bash
# TermPod shell integration for bash
# Emits OSC 133 semantic prompt markers (FinalTerm standard)
# Loaded via --init-file when shell integration is enabled.

# Guard against double-sourcing
[[ -n "$TERMPOD_SHELL_INTEGRATION" ]] && return 0
TERMPOD_SHELL_INTEGRATION=1

# Source user's startup files (--init-file replaces normal startup)
if [[ -n "$TERMPOD_BASH_LOGIN" ]]; then
    unset TERMPOD_BASH_LOGIN
    [[ -f /etc/profile ]] && . /etc/profile
    if [[ -f "$HOME/.bash_profile" ]]; then
        . "$HOME/.bash_profile"
    elif [[ -f "$HOME/.bash_login" ]]; then
        . "$HOME/.bash_login"
    elif [[ -f "$HOME/.profile" ]]; then
        . "$HOME/.profile"
    fi
else
    [[ -f "$HOME/.bashrc" ]] && . "$HOME/.bashrc"
fi

# --- OSC 133 semantic prompt markers ---

_termpod_executing=""
_termpod_in_pc=""

# Track input state for autocomplete
_termpod_last_line=""
_termpod_last_point=0

__termpod_prompt_command() {
    local ret=$?
    _termpod_in_pc=1

    # D marker: previous command finished (with exit code)
    if [[ -n "$_termpod_executing" ]]; then
        printf '\e]133;D;%d\a' "$ret"
    fi
    _termpod_executing=""

    # A marker: prompt start
    printf '\e]133;A\a'

    # B marker: embedded in PS1 (prompt end / input start)
    if [[ "$PS1" != *'133;B'* ]]; then
        PS1="${PS1}\[\e]133;B\a\]"
    fi

    _termpod_in_pc=""
}

# DEBUG trap provides preexec-like behavior
__termpod_debug_trap() {
    # Skip during PROMPT_COMMAND execution
    [[ -n "$_termpod_in_pc" ]] && return
    # Skip if already executing (avoid duplicate C markers)
    [[ -n "$_termpod_executing" ]] && return
    # Skip our own internal functions
    [[ "$BASH_COMMAND" == __termpod_* ]] && return
    [[ "$BASH_COMMAND" == _termpod_* ]] && return

    # C marker: command execution start (output begins)
    printf '\e]133;C\a'
    _termpod_executing=1
    
    # Clear input state when executing
    _termpod_last_line=""
    _termpod_last_point=0
    printf '\e]134;execute\a'
}

# Capture input buffer and cursor position for autocomplete
# Uses READLINE_LINE and READLINE_POINT which are available in bash 4.0+
__termpod_capture_input() {
    # Check if readline variables are available
    if [[ -n "${READLINE_LINE+x}" ]]; then
        local line="$READLINE_LINE"
        local point=$READLINE_POINT
        
        # Only emit if changed
        if [[ "$line" != "$_termpod_last_line" || $point -ne $_termpod_last_point ]]; then
            _termpod_last_line="$line"
            _termpod_last_point=$point
            
            # Base64 encode the buffer
            local encoded
            if command -v base64 >/dev/null 2>&1; then
                encoded=$(printf '%s' "$line" | base64)
            else
                # Fallback: use URL encoding for simple cases
                encoded=$(printf '%s' "$line" | od -An -tx1 | tr -d ' \n')
            fi
            
            printf '\e]134;input;%s;%d\a' "$encoded" "$point"
        fi
    fi
}

# Hook into readline to capture input
# Use bind -x to execute function on every keystroke (bash 4.0+)
if [[ "${BASH_VERSINFO[0]}" -ge 4 ]]; then
    # Create a wrapper that captures input then performs default action
    __termpod_self_insert() {
        __termpod_capture_input
        READLINE_LINE="${READLINE_LINE:0:$READLINE_POINT}${READLINE_LINE:$READLINE_POINT}"
        ((READLINE_POINT++))
    }
    
    __termpod_backward_delete() {
        __termpod_capture_input
        if [[ $READLINE_POINT -gt 0 ]]; then
            READLINE_LINE="${READLINE_LINE:0:$((READLINE_POINT-1))}${READLINE_LINE:$READLINE_POINT}"
            ((READLINE_POINT--))
        fi
    }
    
    # Bind to common editing keys
    bind -x '"\\C-x\\C-i": __termpod_self_insert' 2>/dev/null || true
    bind -x '"\\C-x\\C-h": __termpod_backward_delete' 2>/dev/null || true
fi

# Register PROMPT_COMMAND (prepend to run before user's)
if [[ -z "$PROMPT_COMMAND" ]]; then
    PROMPT_COMMAND="__termpod_prompt_command"
elif [[ "$PROMPT_COMMAND" != *"__termpod_prompt_command"* ]]; then
    PROMPT_COMMAND="__termpod_prompt_command;${PROMPT_COMMAND}"
fi

# Install DEBUG trap for preexec
trap '__termpod_debug_trap' DEBUG
