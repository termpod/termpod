# TermPod shell integration for fish
# Emits OSC 133 semantic prompt markers (FinalTerm standard)
# Auto-loaded via vendor_conf.d when XDG_DATA_DIRS includes our directory.

if set -q TERMPOD_SHELL_INTEGRATION
    return
end
set -g TERMPOD_SHELL_INTEGRATION 1

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

# C marker: command execution start (output begins)
function __termpod_preexec --on-event fish_preexec
    printf '\e]133;C\a'
end

# D marker: command finished (with exit code)
function __termpod_postexec --on-event fish_postexec
    printf '\e]133;D;%d\a' $status
end
