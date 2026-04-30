#!/bin/bash
# PreToolUse hook for the Bash tool: rewrite the tool input so the
# original command runs via `ape-shell -c <cmd>`. That re-routes every
# Bash invocation through the apes grant flow, so the agent cannot
# execute shell commands without an approved grant.
exec python3 -c '
import json, shlex, sys
data = json.load(sys.stdin)
cmd = data["tool_input"]["command"]
wrapped = "ape-shell -c " + shlex.quote(cmd)
out = {"hookSpecificOutput": {"hookEventName": "PreToolUse", "updatedToolInput": {"command": wrapped}}}
print(json.dumps(out))
'
