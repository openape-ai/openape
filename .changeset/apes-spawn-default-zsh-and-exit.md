---
"@openape/apes": minor
---

apes: `apes agents spawn` defaults to `/bin/zsh` (not ape-shell) + `exit` always succeeds in ape-shell

Two related changes that backtrack from making ape-shell the default login shell for spawned agents:

- **`apes agents spawn <name>` now defaults `--shell` to `/bin/zsh`** (macOS modern default) instead of `$(which ape-shell)`. Pass `--shell $(which ape-shell)` to opt the agent's macOS user into the grant-mediated REPL as login shell. Rationale: ape-shell intercepts every command through the grant flow, which trips on interactive niceties (terminal control sequences from Warp/iTerm, etc.) — bash/zsh as login shell with Claude's hook still routing Claude-issued commands through ape-shell is the safer default.
- **`exit` (and `exit <code>`) in the ape-shell REPL always bypasses approval.** Getting OUT of the shell is a foot-gun if it requires a grant — agents and humans alike should be able to leave reliably even when the IdP is unreachable, the token has expired, or anything else has gone wrong.

The `--no-claude-hook` flag is unchanged: the Claude bash-rewrite hook is still installed by default, so Claude-issued commands still go through the grant flow.
