---
'@openape/apes': minor
---

Agent-level system prompt + task-output-to-chat DM. Tasks now carry a `userPrompt` (the imperative job description) instead of a per-task `systemPrompt`; the agent itself owns the system prompt (persona, behaviour rules) and it applies to both cron task runs and live chat-bridge messages. After every cron run, `apes agents run` posts the `final_message` as a chat DM from the agent to its owner — best-effort, silently skips when the contact isn't accepted yet.

Sync now writes `~/.openape/agent/agent.json` with `{systemPrompt}`; the chat-bridge daemon re-reads it per inbound message so owner-side prompt edits via the troop UI propagate within one sync cycle (~5min) without a daemon restart.

Migration: existing per-task `system_prompt` columns get renamed to `user_prompt` by the troop server's idempotent migration; semantically the old content was always task-imperative anyway.
