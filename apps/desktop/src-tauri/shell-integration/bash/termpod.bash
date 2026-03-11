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

__termpod_prompt_command() {
    local ret=$?
    _termpod_in_pc=1

    # D marker: previous command finished (with exit code)
    if [[ -n "$_termpod_executing" ]]; then
        printf '\e]133;D;%d\a' "$ret"
        printf '\n'
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
}

# Register PROMPT_COMMAND (prepend to run before user's)
if [[ -z "$PROMPT_COMMAND" ]]; then
    PROMPT_COMMAND="__termpod_prompt_command"
elif [[ "$PROMPT_COMMAND" != *"__termpod_prompt_command"* ]]; then
    PROMPT_COMMAND="__termpod_prompt_command;${PROMPT_COMMAND}"
fi

# Install DEBUG trap for preexec
trap '__termpod_debug_trap' DEBUG
