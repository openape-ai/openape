---
'@openape/chat-bridge': patch
---

CronRunner now reports run history to troop. Each fire opens a `running` row via `POST /api/agents/me/runs`, and the `done`/`error` event PATCHes it with status + final_message + step_count. Closes the gap left by moving cron in-process from per-task launchd plists (#348) — without this, the troop owner UI's "Recent runs" stayed empty after every fire.
