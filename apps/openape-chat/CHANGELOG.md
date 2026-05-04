# @openape/chat

## 0.1.1

### Patch Changes

- Updated dependencies [[`cbcffc7`](https://github.com/openape-ai/openape/commit/cbcffc74d7fe08520c1a18f2d546181446c1cfca)]:
  - @openape/auth@0.7.0
  - @openape/nuxt-auth-sp@0.8.1

## 0.1.0

### Minor Changes

- [#256](https://github.com/openape-ai/openape/pull/256) [`e77ba19`](https://github.com/openape-ai/openape/commit/e77ba19f595ec72f628f0b274b02a5a307269b77) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Phase B: multiple parallel threads per chat room (ChatGPT-style sessions per contact).

  - Server: new `threads` table + `messages.thread_id` column. New endpoints `GET/POST /api/rooms/:id/threads`, `PATCH/DELETE /api/threads/:id`. `messages.get` accepts `thread_id` filter; `messages.post` accepts `thread_id` and falls back to a lazily-created `main` thread for back-compat with existing rooms. Contacts auto-create the main thread on DM creation.
  - Bridge: pi-RPC sessions are now keyed by `(roomId, threadId)` so parallel conversations with the same human stay in independent contexts. Inbound messages without `threadId` are dropped (server guarantees the field).
  - CLI: new `ape-chat threads {list|new|use|rename|archive}` command, plus `--thread` flags on `send` and `list`. Active thread is remembered per-room in `~/.openape/auth-chat.json`.
  - Webapp: thread switcher tabs in the room view (mobile-first horizontal scroll), `+` to create a thread inline, messages and outgoing posts scoped to the active thread.

## 0.0.1

### Patch Changes

- [#234](https://github.com/openape-ai/openape/pull/234) [`a3555a3`](https://github.com/openape-ai/openape/commit/a3555a3683896e3607e44be06e365edc38ffaf28) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Add `/api/cli/exchange` to chat-app for RFC 8693-style token exchange (parity with ape-tasks/ape-plans). `@openape/ape-chat` now prefers SP-scoped tokens (cached 30 days at `~/.config/apes/sp-tokens/chat.openape.ai.json`) but falls back gracefully to raw IdP tokens when talking to a chat deployment that pre-dates the exchange endpoint.
