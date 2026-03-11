# TermPod shell integration bootstrap for zsh
# This file is sourced because ZDOTDIR was temporarily set to this directory.
# It restores the original ZDOTDIR and sources the user's real .zshenv,
# then loads TermPod's OSC 133 shell integration hooks.

# Get the directory containing this file (needed to source termpod.zsh)
builtin typeset -g TERMPOD_SHELL_INTEGRATION_DIR="${${(%):-%x}:A:h}"

# Restore the user's original ZDOTDIR
if [[ -n "$TERMPOD_ORIG_ZDOTDIR" ]]; then
    ZDOTDIR="$TERMPOD_ORIG_ZDOTDIR"
else
    ZDOTDIR="$HOME"
fi
unset TERMPOD_ORIG_ZDOTDIR

# Source the user's real .zshenv
if [[ -f "$ZDOTDIR/.zshenv" ]]; then
    builtin source "$ZDOTDIR/.zshenv"
fi

# Load TermPod shell integration (OSC 133 markers)
builtin source "$TERMPOD_SHELL_INTEGRATION_DIR/termpod.zsh"
