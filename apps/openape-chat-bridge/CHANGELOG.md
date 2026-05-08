# @openape/chat-bridge

## 1.0.0

### Major Changes

- [#332](https://github.com/openape-ai/openape/pull/332) [`a77db3a`](https://github.com/openape-ai/openape/commit/a77db3a4be9cc3e37af574578a70fb5095c73cc5) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - **BREAKING**: chat-bridge now spawns `apes agents serve --rpc` instead of `pi --mode rpc`. Drops the `@mariozechner/pi-coding-agent` runtime dependency entirely — the bridge runs against `@openape/apes` (≥ 0.32.0) which embeds a LiteLLM-backed runtime with the OpenApe tool catalog.

  Env vars changed:

  - removed: `APE_CHAT_BRIDGE_PI_BIN`, `APE_CHAT_BRIDGE_PROVIDER`
  - renamed: `APE_CHAT_BRIDGE_MODEL` (default now `claude-haiku-4-5` instead of `gpt-5.4`)
  - new: `APE_CHAT_BRIDGE_APES_BIN` (default: `apes` on `$PATH`), `APE_CHAT_BRIDGE_TOOLS` (comma-separated, default empty), `APE_CHAT_BRIDGE_MAX_STEPS` (default 10), `APE_CHAT_BRIDGE_SYSTEM_PROMPT` (default: friendly assistant)

  Migration on existing agent hosts: re-run `apes agents spawn --bridge <name>` so the launchd plist + start.sh pick up the new env defaults.

## 0.3.2

### Patch Changes

- Updated dependencies [[`6539c9b`](https://github.com/openape-ai/openape/commit/6539c9b290b9d9f062f54dfdf5378957ee668018)]:
  - @openape/cli-auth@0.3.0

## 0.3.1

### Patch Changes

- [`b519e3f`](https://github.com/openape-ai/openape/commit/b519e3f858011358056daaec8f54a2694c59f191) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Fix bridge crash-loop "auth.json missing 'owner_email'" after `apes login`.

  - `@openape/cli-auth`: `saveIdpAuth` now merges with existing fields instead of overwriting wholesale. `apes login` (called from the bridge's `start.sh` on every daemon boot) used to silently drop `owner_email` written by `apes agents spawn`, leaving the bridge in a fatal restart loop until the auth.json was manually re-stamped. The merge preserves any unknown keys in the file across logins.
  - `@openape/chat-bridge`: `readAgentIdentity` falls back to `OPENAPE_OWNER_EMAIL` env var when `owner_email` is missing from auth.json, so an old agent (spawned before the Phase A migration) can be unblocked by adding one line to its launchd plist.

- Updated dependencies [[`b519e3f`](https://github.com/openape-ai/openape/commit/b519e3f858011358056daaec8f54a2694c59f191)]:
  - @openape/cli-auth@0.2.4

## 0.3.0

### Minor Changes

- [#256](https://github.com/openape-ai/openape/pull/256) [`e77ba19`](https://github.com/openape-ai/openape/commit/e77ba19f595ec72f628f0b274b02a5a307269b77) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Phase B: multiple parallel threads per chat room (ChatGPT-style sessions per contact).

  - Server: new `threads` table + `messages.thread_id` column. New endpoints `GET/POST /api/rooms/:id/threads`, `PATCH/DELETE /api/threads/:id`. `messages.get` accepts `thread_id` filter; `messages.post` accepts `thread_id` and falls back to a lazily-created `main` thread for back-compat with existing rooms. Contacts auto-create the main thread on DM creation.
  - Bridge: pi-RPC sessions are now keyed by `(roomId, threadId)` so parallel conversations with the same human stay in independent contexts. Inbound messages without `threadId` are dropped (server guarantees the field).
  - CLI: new `ape-chat threads {list|new|use|rename|archive}` command, plus `--thread` flags on `send` and `list`. Active thread is remembered per-room in `~/.openape/auth-chat.json`.
  - Webapp: thread switcher tabs in the room view (mobile-first horizontal scroll), `+` to create a thread inline, messages and outgoing posts scoped to the active thread.

## 0.2.2

### Patch Changes

- [#253](https://github.com/openape-ai/openape/pull/253) [`1b05c4b`](https://github.com/openape-ai/openape/commit/1b05c4b0c3b9cb61e353979d1b66e3b4670cf22d) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Phase A frontend + CLI:

  - chat.openape.ai webapp shows contacts (incoming pending, connected, outgoing pending) with accept/decline/cancel actions and an "Add contact" dialog. Mobile-first. Live-updates via WS membership-\* frames.
  - `@openape/ape-chat`: new `contacts list / add / accept / remove` subcommand.
  - `@openape/apes`: new `apes agents allow <agent> <peer-email>` — adds peer to the agent's bridge-allowlist file so the bridge auto-accepts that peer's contact request.
  - chat-bridge polls the allowlist + pending contacts every 30s while connected, so an `apes agents allow` change takes effect within half a minute without a daemon restart.

## 0.2.1

### Patch Changes

- [#251](https://github.com/openape-ai/openape/pull/251) [`c314e7a`](https://github.com/openape-ai/openape/commit/c314e7a3f6594e097166024ac6465bbb2c181a80) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Phase A backend — chat-app gains a `contacts` table + friend-request lifecycle. `apes agents spawn --bridge` now POSTs `/api/contacts` instead of creating a DM room directly; the bridge daemon accepts pending requests on first connect, completing the bilateral handshake without manual intervention. Direct `POST /api/rooms { kind: 'dm' }` is now rejected — DMs are owned by the contacts model and lazy-created on bilateral accept.

## 0.2.0

### Minor Changes

- [`3c0d06c`](https://github.com/openape-ai/openape/commit/3c0d06c35e3974de009a19f7041e88e1e77421ae) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - `@openape/chat-bridge` rewritten to drive pi via its RPC mode (`pi --mode rpc`) instead of one-shot `pi --print` per message. One long-lived pi subprocess per chat room means the conversation now has memory across messages — "what's 7×6?" then "and ×2?" produces "84" not a confused "what do you mean ×2?". The agent's reply also visibly grows in real time as pi streams `text_delta` events: bridge posts a placeholder message and PATCHes it progressively (throttled ~300ms).

  `@openape/apes`: bridge `start.sh` now always pulls `@openape/chat-bridge@latest` on boot, so restarting the launchd daemon picks up new bridge versions without manual intervention. Pi extension setup unchanged.

## 0.1.0

### Minor Changes

- [#229](https://github.com/openape-ai/openape/pull/229) [`2177da5`](https://github.com/openape-ai/openape/commit/2177da505f4c0b241e3d9bfdf2253695d7c3c81a) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Initial release of `@openape/ape-chat` (CLI for chat.openape.ai) and `@openape/chat-bridge` (daemon that lets a local LLM CLI like pi answer chat messages on behalf of an apes-spawned agent). See each package's README for setup and usage.
