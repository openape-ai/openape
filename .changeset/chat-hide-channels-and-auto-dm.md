---
"@openape/apes": minor
---

Bridge model shifts to 1:1-only. `apes agents spawn --bridge` no longer takes `--bridge-room <name>` — it auto-creates a DM between the spawning user and the new agent. The chat-app UI hides channels (group chats) until the contacts model lands; agents in shared rooms produce reply-loops between agents and there's no reliable way to filter agent-from-human messages yet. Existing channels are not deleted, just hidden from the room list. Direct URL access to a channel still works for back-compat.
