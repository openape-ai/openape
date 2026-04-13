---
'@openape/apes': minor
---

feat(apes): REPL meta-commands (`:help`, `:status`, `:reset`)

The `ape-shell` interactive REPL now recognizes three meta-commands that are dispatched before the grant flow and the bash pty. They only fire from an empty input buffer (never mid-multiline) and can never be confused with shell commands that happen to start with a colon.

### `:help`

Lists available meta-commands with one-line descriptions.

### `:status`

Prints the current session state — session id, uptime, host, bash child pid, requester identity, IdP URL, and token validity. Auth is re-read at invocation time so external token refreshes are visible immediately. Supports expired and not-logged-in states without throwing.

```
Session: 3f7a9e2c1b8d4f05 (uptime 12m 34s)
Host:    lappy.local
Bash:    pid 54321
User:    alice@example.com
IdP:     https://id.openape.at
Token:   valid until 2026-05-14T14:25:31.000Z
```

### `:reset`

Kills the current bash pty child and spawns a fresh one. This is the recovery lever when bash gets into a weird state (stuck subshell, leftover environment, unexpected prompt). The session audit log is **preserved** (same session id, continuous event stream) so `:reset` does not look like a new shell to downstream consumers. Grants do not need resetting — they are re-fetched server-side on every line anyway.

`:reset` refuses while a command is in flight (`Cannot reset while a command is running. Wait or press Ctrl-C.`) to avoid orphaning an in-flight promise.

Together with `apes health` (shipped alongside), these give the user observability into and recovery from the grant-gated shell without having to exit and restart.
