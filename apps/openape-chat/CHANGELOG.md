# @openape/chat

## 0.0.1

### Patch Changes

- [#234](https://github.com/openape-ai/openape/pull/234) [`a3555a3`](https://github.com/openape-ai/openape/commit/a3555a3683896e3607e44be06e365edc38ffaf28) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Add `/api/cli/exchange` to chat-app for RFC 8693-style token exchange (parity with ape-tasks/ape-plans). `@openape/ape-chat` now prefers SP-scoped tokens (cached 30 days at `~/.config/apes/sp-tokens/chat.openape.ai.json`) but falls back gracefully to raw IdP tokens when talking to a chat deployment that pre-dates the exchange endpoint.
