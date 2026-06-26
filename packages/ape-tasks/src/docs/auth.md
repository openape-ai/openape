# Auth

## Paste-based login

`ape-tasks login [email]` prints a URL, expects a token paste.

1. Open `{endpoint}/cli-login` in a browser.
2. Sign in with your email (DDISA-discovered IdP).
3. Click "Generate CLI token".
4. Copy the token and paste it into the CLI prompt.

The token is an HS256 JWT signed by tasks.openape.ai. It carries `sub`, `email`,
and `act` (human vs agent). Valid for 30 days by default. Stored at
`~/.openape/auth-tasks.json` with mode 0600.

## Why paste-based, not OAuth device flow?

The MVP keeps agent onboarding simple and works against any IdP the user has
already configured through DDISA. A browser-based device flow against the IdP
is possible later; for now, one paste per 30 days is acceptable.

## Rotating

Forcing all CLI sessions to re-login: change `NUXT_CLI_TOKEN_SECRET` on the
server. Existing tokens become invalid immediately; users run `ape-tasks login`
again.

## Endpoints

The CLI supports multiple endpoints (prod, dev, self-hosted) in a single
config file under `endpoints["<url>"]`. `activeEndpoint` picks the default;
`--endpoint <url>` overrides per invocation. Login to a new endpoint just
creates a new key; it does not replace existing ones.
