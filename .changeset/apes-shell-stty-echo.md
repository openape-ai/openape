---
'@openape/apes': patch
---

fix(apes): suppress pty input echo in interactive ape-shell REPL

The persistent bash child runs inside a pty whose default line discipline
echoes input back in canonical mode. Combined with the ape-shell readline
frontend (which already renders `apes$ <line>`), this caused every command
to appear twice in the user's terminal:

```
apes$ whoami            ← readline echo (frontend)
ℹ Requesting grant for: …
whoami                  ← pty line-discipline echo (redundant)
openclaw                ← actual output
apes$
```

Fix: prepend `stty -echo 2>/dev/null` to `PROMPT_COMMAND` so the pty's
input echo is disabled before every prompt, matching the single-echo
behavior of a regular interactive shell. Runs after every prompt so it
also re-applies if a user command toggles echo. Interactive TUI apps
(vim, less, top) set their own termios when they start and are
unaffected.
