# @openape/chat-bridge

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
