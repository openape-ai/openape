# @openape/ape-chat

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
