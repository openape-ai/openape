---
'@openape/apes': minor
---

feat(apes): add PtyBridge — pty wrapper around a persistent bash child

First milestone (M1) of the interactive `ape-shell` REPL feature (#62).

`PtyBridge` spawns a persistent bash child via `node-pty` with a random-hex marker embedded in `PROMPT_COMMAND` + `PS1`. It detects marker occurrences in the output stream, strips them before they reach the consumer, and fires `onLineDone` with the accumulated output + exit code once bash has finished each command.

Full shell state (cwd, environment variables, aliases, functions) persists across calls because a single bash process stays alive between commands.

This lands as internal infrastructure only — no user-visible command or REPL loop is wired up yet. That follows in later milestones.
