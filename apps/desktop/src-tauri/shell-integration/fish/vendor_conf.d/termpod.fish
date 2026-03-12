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
function __termpod_capture_input --on-event fish_posterror
    # Alternative: use fish_prompt event to capture periodically
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

# Capture input on each keystroke using fish key bindings
function __termpod_capture_buffer
    set -l buffer (commandline)
    set -l cursor (commandline -C)
    
    # Only emit if changed
    if test "$buffer" != "$__termpod_last_buffer" -o $cursor -ne $__termpod_last_cursor
        set -g __termpod_last_buffer "$buffer"
        set -g __termpod_last_cursor $cursor
        
        # Base64 encode the buffer (fish built-in)
        set -l encoded (printf '%s' "$buffer" | base64)
        printf '\e]134;input;%s;%d\a' "$encoded" $cursor
    end
    
    # Perform the original action
    commandline -f accept-autosuggestion
end

# Bind to capture input on common editing actions
# Note: fish doesn't have per-keystroke hooks like zsh, so we use accept-autosuggestion as a trigger
# A more robust approach would use fish's --on-variable or periodic checks
