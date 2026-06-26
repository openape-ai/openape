# Authentication

ape-pr uses the unified OpenApe CLI session:

1. `apes login <email>` — once per device. Opens a DDISA flow against
   id.openape.ai and stores the IdP token in `~/.config/apes/auth.json`.
2. Every ape-pr command transparently exchanges that token at
   `POST https://pr.openape.ai/api/cli/exchange` (RFC 8693) for an
   SP-scoped bearer token, cached in `~/.config/apes/sp-tokens/`.

There is no `ape-pr login` — it is a stub that points to `apes login`.

`ape-pr logout` clears only the cached PR SP token. The apes IdP
session stays; `apes logout` clears that.

Public report pages (`/r/<slug>`) need no authentication at all — the slug
is the capability.
