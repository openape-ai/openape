---
"@openape/apes": minor
"@openape/ape-chat": minor
"@openape/chat-bridge": patch
---

Phase A frontend + CLI:

- chat.openape.ai webapp shows contacts (incoming pending, connected, outgoing pending) with accept/decline/cancel actions and an "Add contact" dialog. Mobile-first. Live-updates via WS membership-* frames.
- `@openape/ape-chat`: new `contacts list / add / accept / remove` subcommand.
- `@openape/apes`: new `apes agents allow <agent> <peer-email>` — adds peer to the agent's bridge-allowlist file so the bridge auto-accepts that peer's contact request.
- chat-bridge polls the allowlist + pending contacts every 30s while connected, so an `apes agents allow` change takes effect within half a minute without a daemon restart.
