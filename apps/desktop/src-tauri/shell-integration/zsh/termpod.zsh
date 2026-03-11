# TermPod shell integration for zsh
# Emits OSC 133 semantic prompt markers (FinalTerm / Kitty / Ghostty standard)
#
# Lifecycle per command:
#   A (prompt start) → [prompt text] → B (prompt end) → [user input] →
#   C (command executed) → [output] → D (command finished, exit code)

# Guard against double-sourcing
(( ${+TERMPOD_SHELL_INTEGRATION} )) && return
builtin typeset -g TERMPOD_SHELL_INTEGRATION=1

# Track whether a command has been executed (controls D marker emission)
builtin typeset -g _termpod_executing=""

# Save exit status FIRST (before any other precmd modifies $?)
_termpod_save_status() {
    builtin typeset -g _termpod_last_status=$?
}

# Emit D (previous command finished) and A (prompt start) markers
_termpod_precmd() {
    if [[ -n "$_termpod_executing" ]]; then
        builtin printf '\e]133;D;%d\a' "$_termpod_last_status"
        builtin printf '\n'
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

# Register hooks:
# - _termpod_save_status FIRST (captures $? before anything else)
# - _termpod_precmd early (emits A, D)
# - _termpod_update_ps1 LAST (appends B after prompt frameworks set PS1)
precmd_functions=(_termpod_save_status _termpod_precmd "${precmd_functions[@]}" _termpod_update_ps1)
preexec_functions=(_termpod_preexec "${preexec_functions[@]}")
