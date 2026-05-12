# @openape/chat

## 0.2.14

### Patch Changes

- Updated dependencies [[`3aecb77`](https://github.com/openape-ai/openape/commit/3aecb770b87ddda5399d5d91da88480b900dd072)]:
  - @openape/nuxt-auth-sp@0.10.0

## 0.2.13

### Patch Changes

- Updated dependencies [[`fd4775f`](https://github.com/openape-ai/openape/commit/fd4775f3a262b961349f011185102ac88994138e)]:
  - @openape/nuxt-auth-sp@0.9.3

## 0.2.12

### Patch Changes

- Updated dependencies [[`362390c`](https://github.com/openape-ai/openape/commit/362390c6da33bb6334ac22830336b5e4903e157c)]:
  - @openape/core@0.16.0
  - @openape/nuxt-auth-sp@0.9.2
  - @openape/auth@0.10.1

## 0.2.11

### Patch Changes

- Updated dependencies [[`55849f0`](https://github.com/openape-ai/openape/commit/55849f06a41aac7ef0663bf5bbb566b0f898c7a8)]:
  - @openape/nuxt-auth-sp@0.9.1

## 0.2.10

### Patch Changes

- Updated dependencies [[`d447ca1`](https://github.com/openape-ai/openape/commit/d447ca14eb4017c36e5da0766b6dc9cf47048310)]:
  - @openape/nuxt-auth-sp@0.9.0

## 0.2.9

### Patch Changes

- Updated dependencies [[`2b1014b`](https://github.com/openape-ai/openape/commit/2b1014bcee0b2e431e80958578a20c1bb6369baa)]:
  - @openape/auth@0.10.0
  - @openape/nuxt-auth-sp@0.8.9

## 0.2.8

### Patch Changes

- Updated dependencies [[`38c5c3c`](https://github.com/openape-ai/openape/commit/38c5c3cf1c2a4b11c4942e4e9eee6ddcec2deff9)]:
  - @openape/core@0.15.0
  - @openape/nuxt-auth-sp@0.8.8
  - @openape/auth@0.9.2

## 0.2.7

### Patch Changes

- Updated dependencies [[`779d8ae`](https://github.com/openape-ai/openape/commit/779d8ae64d00fb7ffaff89275c7c53df51308174)]:
  - @openape/auth@0.9.1
  - @openape/nuxt-auth-sp@0.8.7

## 0.2.6

### Patch Changes

- Updated dependencies [[`2e753fd`](https://github.com/openape-ai/openape/commit/2e753fda9e7beaf1cec20077fbe2576a52c1c1df)]:
  - @openape/auth@0.9.0
  - @openape/nuxt-auth-sp@0.8.6

## 0.2.5

### Patch Changes

- Updated dependencies [[`788a945`](https://github.com/openape-ai/openape/commit/788a9459170ec03427422c6d3d0f3daa5f266712)]:
  - @openape/auth@0.8.1
  - @openape/nuxt-auth-sp@0.8.5

## 0.2.4

### Patch Changes

- Updated dependencies [[`f787da5`](https://github.com/openape-ai/openape/commit/f787da57a04e3f5ea57395c16278f24fd89c5ebc)]:
  - @openape/auth@0.8.0
  - @openape/nuxt-auth-sp@0.8.4

## 0.2.3

### Patch Changes

- Updated dependencies [[`8271991`](https://github.com/openape-ai/openape/commit/8271991f42d18a32b8dfd4e7306f6dd294d3a286)]:
  - @openape/auth@0.7.2
  - @openape/nuxt-auth-sp@0.8.3

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
