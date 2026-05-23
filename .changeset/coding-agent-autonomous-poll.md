---
"@openape/ape-agent": patch
"@openape/apes": patch
---

feat(coding-agent): deterministic, headless cron poll via task `command`

Recipe schedules can now carry an explicit `command`. troop threads it
through materialize → deploy plan → the `tasks.command` column → the
agent's task sync, and the cron-runner executes it via the gated
ape-shell path with no LLM round-trip. Crucially, a command task fires
headless — it no longer requires an active owner chat room, so the
coding-agent's `*/10` poll runs autonomously (clone → worktree → edit →
verify → PR) without anyone accepting a contact in chat first.
