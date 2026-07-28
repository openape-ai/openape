# Authentication

ape-testruns uses the unified OpenApe CLI session:

1. `apes login <email>` — once per device. Opens a DDISA flow against
   id.openape.ai and stores the IdP token in `~/.config/apes/auth.json`.
2. Every ape-testruns command transparently exchanges that token at
   `POST https://testrun.openape.ai/api/cli/exchange` (RFC 8693) for an
   SP-scoped bearer token, cached in `~/.config/apes/sp-tokens/`.

There is no `ape-testruns login` — it is a stub that points to `apes login`.

`ape-testruns logout` clears only the cached testrun SP token. The apes IdP
session stays; `apes logout` clears that.

Public report pages (`/r/<slug>`) need no authentication at all — the slug
is the capability.
