---
'@openape/apes': minor
'@openape/chat-bridge': minor
---

Cron tasks now run **inside the chat-bridge daemon** instead of via per-task launchd plists. One process, one LiteLLM config (the bridge's), one WebSocket to chat.openape.ai. The bridge's existing `ApesRpcSession` is reused for task fires — fixed `session_id = task:<taskId>` so the runtime carries memory across runs (within its evict TTL), fixed chat thread per task (persisted to `~/.openape/agent/task-threads.json`) so all runs of one task land in the same chat thread instead of fanning out into N independent DMs.

`apes agents sync` no longer reconciles per-task launchd plists. The chat-bridge's `CronRunner` ticks every 60s, reads `~/.openape/agent/tasks/*.json`, fires anything whose cron matches the current minute. `apes agents run` is now optional (kept for ad-hoc invocation but no longer scheduled by the bridge stack).
