# TermPod shell integration for fish
# Emits OSC 133 semantic prompt markers (FinalTerm standard)
# Auto-loaded via vendor_conf.d when XDG_DATA_DIRS includes our directory.

if set -q TERMPOD_SHELL_INTEGRATION
    return
end
set -g TERMPOD_SHELL_INTEGRATION 1

# Track input state for autocomplete
set -g __termpod_last_buffer ""
set -g __termpod_last_cursor 0

# A marker: prompt start
function __termpod_prompt_start --on-event fish_prompt
    printf '\e]133;A\a'
end

# B marker: after prompt text (wrap the existing fish_prompt function)
if functions -q fish_prompt
    functions --copy fish_prompt __termpod_orig_fish_prompt
    function fish_prompt
        __termpod_orig_fish_prompt
        printf '\e]133;B\a'
    end
else
    function fish_prompt
        printf '\e]133;B\a'
    end
end

# Capture input buffer and cursor position for autocomplete
# Uses OSC 134 to send input state to the terminal
function __termpod_capture_input
    set -l buffer (commandline)
    set -l cursor (commandline -C)

    # Only emit if changed
    if test "$buffer" != "$__termpod_last_buffer" -o "$cursor" != "$__termpod_last_cursor"
        set -g __termpod_last_buffer "$buffer"
        set -g __termpod_last_cursor $cursor

        # Base64 encode the buffer (fish built-in)
        set -l encoded (printf '%s' "$buffer" | base64)
        printf '\e]134;input;%s;%d\a' "$encoded" $cursor
    end
end

# C marker: command execution start (output begins)
function __termpod_preexec --on-event fish_preexec
    printf '\e]133;C\a'

    # Clear input state and emit execute marker
    set -g __termpod_last_buffer ""
    set -g __termpod_last_cursor 0
    printf '\e]134;execute\a'
end

# D marker: command finished (with exit code)
function __termpod_postexec --on-event fish_postexec
    printf '\e]133;D;%d\a' $status
end

# Bind editing keys to capture input after each keystroke.
# Fish lacks per-keystroke hooks like zsh, so we bind common editing
# actions to wrapper functions that run the default action then capture.

function __termpod_self_insert
    commandline -f self-insert
    __termpod_capture_input
end

function __termpod_backward_delete
    commandline -f backward-delete-char
    __termpod_capture_input
end

function __termpod_delete_char
    commandline -f delete-char
    __termpod_capture_input
end

function __termpod_backward_word_delete
    commandline -f backward-kill-word
    __termpod_capture_input
end

function __termpod_kill_line
    commandline -f kill-line
    __termpod_capture_input
end

function __termpod_backward_kill_line
    commandline -f backward-kill-line
    __termpod_capture_input
end

# Bind in default and insert modes
for mode in default insert
    # Self-insert covers all printable characters
    bind --mode $mode --preset "" __termpod_self_insert
    bind --mode $mode \x7f __termpod_backward_delete
    bind --mode $mode \b __termpod_backward_delete
    bind --mode $mode \e\[3~ __termpod_delete_char
    bind --mode $mode \cw __termpod_backward_word_delete
    bind --mode $mode \ck __termpod_kill_line
    bind --mode $mode \cu __termpod_backward_kill_line
end
