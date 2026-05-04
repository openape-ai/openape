# @openape/ape-chat

## 0.4.0

### Minor Changes

- [#287](https://github.com/openape-ai/openape/pull/287) [`42787d3`](https://github.com/openape-ai/openape/commit/42787d3e6513802850396742e3101f0e9a48dac2) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Remove the `kind:'channel'` rooms model and associated mutation endpoints (closes #276).

  Phase A already migrated the chat UI to a 1:1-DM-only model (rooms are auto-created by the contact-accept flow), but the server still exposed enough surface to attack:

  - `POST /api/rooms` (channel-creation) — any authenticated user could enrol arbitrary emails as members; the targets immediately saw the attacker-named "channel" plus Web Push notifications with arbitrary 140-char text. Perfect phishing channel routed via chat.openape.ai.
  - `POST /api/rooms/:id/members` — admins could add any email and promote them to admin without a contact relationship.
  - `PATCH/DELETE /api/rooms/:id/members/:email` — same blast radius for role changes / kicks.
  - `POST /api/rooms/:id/{join,leave}` — channel-only flows.

  All six endpoints are gone. The schema's `kind` enum is narrowed to `['dm']` only (existing 'channel' rows in production stay readable via drizzle's runtime cast — the column constraint is a TypeScript-level narrowing, not a DB migration). The CLI's `rooms create` and `members add/remove` subcommands are gone for the same reason; the read-only `members list` and the entire contacts flow are unchanged. The webapp's MemberManager component is read-only.

  Surfaced in the security audit on 2026-05-04.

## 0.3.2

### Patch Changes

- Updated dependencies [[`6539c9b`](https://github.com/openape-ai/openape/commit/6539c9b290b9d9f062f54dfdf5378957ee668018)]:
  - @openape/cli-auth@0.3.0

## 0.3.1

### Patch Changes

- Updated dependencies [[`b519e3f`](https://github.com/openape-ai/openape/commit/b519e3f858011358056daaec8f54a2694c59f191)]:
  - @openape/cli-auth@0.2.4

## 0.3.0

### Minor Changes

- [#256](https://github.com/openape-ai/openape/pull/256) [`e77ba19`](https://github.com/openape-ai/openape/commit/e77ba19f595ec72f628f0b274b02a5a307269b77) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Phase B: multiple parallel threads per chat room (ChatGPT-style sessions per contact).

  - Server: new `threads` table + `messages.thread_id` column. New endpoints `GET/POST /api/rooms/:id/threads`, `PATCH/DELETE /api/threads/:id`. `messages.get` accepts `thread_id` filter; `messages.post` accepts `thread_id` and falls back to a lazily-created `main` thread for back-compat with existing rooms. Contacts auto-create the main thread on DM creation.
  - Bridge: pi-RPC sessions are now keyed by `(roomId, threadId)` so parallel conversations with the same human stay in independent contexts. Inbound messages without `threadId` are dropped (server guarantees the field).
  - CLI: new `ape-chat threads {list|new|use|rename|archive}` command, plus `--thread` flags on `send` and `list`. Active thread is remembered per-room in `~/.openape/auth-chat.json`.
  - Webapp: thread switcher tabs in the room view (mobile-first horizontal scroll), `+` to create a thread inline, messages and outgoing posts scoped to the active thread.

## 0.2.0

### Minor Changes

- [#253](https://github.com/openape-ai/openape/pull/253) [`1b05c4b`](https://github.com/openape-ai/openape/commit/1b05c4b0c3b9cb61e353979d1b66e3b4670cf22d) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Phase A frontend + CLI:

  - chat.openape.ai webapp shows contacts (incoming pending, connected, outgoing pending) with accept/decline/cancel actions and an "Add contact" dialog. Mobile-first. Live-updates via WS membership-\* frames.
  - `@openape/ape-chat`: new `contacts list / add / accept / remove` subcommand.
  - `@openape/apes`: new `apes agents allow <agent> <peer-email>` — adds peer to the agent's bridge-allowlist file so the bridge auto-accepts that peer's contact request.
  - chat-bridge polls the allowlist + pending contacts every 30s while connected, so an `apes agents allow` change takes effect within half a minute without a daemon restart.

## 0.1.0

### Minor Changes

- [#229](https://github.com/openape-ai/openape/pull/229) [`2177da5`](https://github.com/openape-ai/openape/commit/2177da505f4c0b241e3d9bfdf2253695d7c3c81a) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Initial release of `@openape/ape-chat` (CLI for chat.openape.ai) and `@openape/chat-bridge` (daemon that lets a local LLM CLI like pi answer chat messages on behalf of an apes-spawned agent). See each package's README for setup and usage.

### Patch Changes

- [#234](https://github.com/openape-ai/openape/pull/234) [`a3555a3`](https://github.com/openape-ai/openape/commit/a3555a3683896e3607e44be06e365edc38ffaf28) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Add `/api/cli/exchange` to chat-app for RFC 8693-style token exchange (parity with ape-tasks/ape-plans). `@openape/ape-chat` now prefers SP-scoped tokens (cached 30 days at `~/.config/apes/sp-tokens/chat.openape.ai.json`) but falls back gracefully to raw IdP tokens when talking to a chat deployment that pre-dates the exchange endpoint.
