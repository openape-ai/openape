# @openape/chat

## 0.2.2

### Patch Changes

- [#290](https://github.com/openape-ai/openape/pull/290) [`7fe19bc`](https://github.com/openape-ai/openape/commit/7fe19bc4ea87fb2bf49b8e9ede3ec02c1955af48) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Canonicalise email casing in `resolveCaller` (closes #282).

  Contacts canonicalised to lowercase but `messages.senderEmail`, `memberships.userEmail`, and edit-ownership checks (`existing.senderEmail !== caller.email`) used `caller.email` as-is from the JWT `sub`. If two casings of the same address ever co-existed (different IdP behaviour, re-issued accounts), they'd be treated as separate identities — `Foo@x.com` user added to a room would appear next to a `foo@x.com` contact, the bridge allowlist (lower-cased) would diverge from server-side membership rows, and authz checks would silently disagree.

  `resolveCaller` now lower-cases the email exactly once at the boundary — every downstream comparison sees the same string regardless of how the IdP emitted the casing. Two regression tests for the cookie + bearer paths.

## 0.2.1

### Patch Changes

- Updated dependencies [[`146a5a3`](https://github.com/openape-ai/openape/commit/146a5a3dd3960b42c7f40a0ece0f7c361934c323)]:
  - @openape/core@0.14.0
  - @openape/nuxt-auth-sp@0.8.2
  - @openape/auth@0.7.1

## 0.2.0

### Minor Changes

- [#287](https://github.com/openape-ai/openape/pull/287) [`42787d3`](https://github.com/openape-ai/openape/commit/42787d3e6513802850396742e3101f0e9a48dac2) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Remove the `kind:'channel'` rooms model and associated mutation endpoints (closes #276).

  Phase A already migrated the chat UI to a 1:1-DM-only model (rooms are auto-created by the contact-accept flow), but the server still exposed enough surface to attack:

  - `POST /api/rooms` (channel-creation) — any authenticated user could enrol arbitrary emails as members; the targets immediately saw the attacker-named "channel" plus Web Push notifications with arbitrary 140-char text. Perfect phishing channel routed via chat.openape.ai.
  - `POST /api/rooms/:id/members` — admins could add any email and promote them to admin without a contact relationship.
  - `PATCH/DELETE /api/rooms/:id/members/:email` — same blast radius for role changes / kicks.
  - `POST /api/rooms/:id/{join,leave}` — channel-only flows.

  All six endpoints are gone. The schema's `kind` enum is narrowed to `['dm']` only (existing 'channel' rows in production stay readable via drizzle's runtime cast — the column constraint is a TypeScript-level narrowing, not a DB migration). The CLI's `rooms create` and `members add/remove` subcommands are gone for the same reason; the read-only `members list` and the entire contacts flow are unchanged. The webapp's MemberManager component is read-only.

  Surfaced in the security audit on 2026-05-04.

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
