---
'@openape/troop': patch
---

Add per-agent tool picker to the agent detail page (`/agents/[name]`). Shows all available tools from `tool-catalog.json` with risk badges + descriptions; checkbox per tool; saves via `PATCH /api/agents/[name] { tools: [...] }`. The chat-bridge re-reads the list on every new chat thread, so changes propagate within the next sync (~5min) without a bridge restart.
