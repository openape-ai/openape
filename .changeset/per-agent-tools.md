---
'@openape/apes': minor
'@openape/chat-bridge': minor
---

Per-agent tool whitelist — owner-controlled via troop, default all-tools-enabled on first sync.

**What changed**:
- `openape-troop`: `agents` table gains a `tools text` column (JSON string array, defaults to `'[]'` for legacy rows). New agents on first sync get the full `tool-catalog.json` list as their default — owner narrows via `PATCH /api/agents/<name>` (the existing endpoint now also accepts `tools: string[]`).
- `GET /api/agents/me/tasks` returns the agent's `tools[]` alongside `system_prompt` and `tasks`.
- `apes agents sync` writes the resolved tool list into `~/.openape/agent/agent.json` (alongside `systemPrompt`).
- `@openape/chat-bridge` reads `tools[]` from `agent.json` on every new chat thread, replacing the legacy `APE_CHAT_BRIDGE_TOOLS` env var as the source of truth. The env var stays as a fallback when `agent.json` doesn't have a `tools` field (e.g. before the next sync).

**Net effect**: tools are now per-agent + owner-editable. Defaults to all 9 shipped tools (`time.now`, `http.get`, `http.post`, `file.read`, `file.write`, `tasks.list`, `tasks.create`, `mail.list`, `mail.search`) so new agents are immediately useful in chat. Owner narrows when needed.

Existing agents (`tools=[]` from migration) get nothing in chat until they sync — recommended one-time fix: `PATCH /api/agents/<name>` with `tools: [<full list>]` per agent, or just `apes agents sync` once and the agent re-registers (which doesn't run the default-all path because the row already exists). For Patrick's local fleet, simplest is a single SQL update on the troop DB to set `tools='[…]'` on existing rows.
