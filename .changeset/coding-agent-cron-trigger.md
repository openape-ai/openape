---
"@openape/apes": minor
"@openape/ape-agent": minor
---

Coding-agent auto-trigger (INT-1b). The cron-runner now supports deterministic `command` tasks: when a task spec carries a `command`, the runner executes it via the gated ape-shell path instead of an LLM runLoop — no model round-trip just to fire a fixed command. `runApeShell` is now exported from `@openape/apes`. The coding-agent recipe's schedule runs `apes agents code --poll-label …` so a deployed agent polls for assigned issues and works them. (Until the recipe→task `command` field is threaded through troop, the recipe schedule expresses the poll as an explicit bash command — the portable fallback.)
