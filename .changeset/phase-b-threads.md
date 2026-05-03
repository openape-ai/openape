---
'@openape/chat': minor
'@openape/ape-chat': minor
'@openape/chat-bridge': minor
---

Phase B: multiple parallel threads per chat room (ChatGPT-style sessions per contact).

- Server: new `threads` table + `messages.thread_id` column. New endpoints `GET/POST /api/rooms/:id/threads`, `PATCH/DELETE /api/threads/:id`. `messages.get` accepts `thread_id` filter; `messages.post` accepts `thread_id` and falls back to a lazily-created `main` thread for back-compat with existing rooms. Contacts auto-create the main thread on DM creation.
- Bridge: pi-RPC sessions are now keyed by `(roomId, threadId)` so parallel conversations with the same human stay in independent contexts. Inbound messages without `threadId` are dropped (server guarantees the field).
- CLI: new `ape-chat threads {list|new|use|rename|archive}` command, plus `--thread` flags on `send` and `list`. Active thread is remembered per-room in `~/.openape/auth-chat.json`.
- Webapp: thread switcher tabs in the room view (mobile-first horizontal scroll), `+` to create a thread inline, messages and outgoing posts scoped to the active thread.
