# @openape/cli-auth

Shared client-side auth library for OpenApe CLIs. Used by `@openape/apes`, `@openape/ape-plans`, `@openape/ape-tasks`, and forthcoming `@openape/ape-secrets` / `@openape/ape-seeds`.

## What it does

The user runs `apes login <email>` once on their device (PKCE browser flow OR SSH-key challenge-response). That stores an IdP-issued OAuth access + refresh token at `~/.config/apes/auth.json`. From then on, every other OpenApe CLI just needs:

```ts
import { getAuthorizedBearer } from '@openape/cli-auth'

const authorization = await getAuthorizedBearer({
  endpoint: 'https://plans.openape.ai',
  aud: 'plans.openape.ai',
  scopes: ['plans:rw'],
})

const teams = await fetch('https://plans.openape.ai/api/teams', {
  headers: { Authorization: authorization },
})
```

`getAuthorizedBearer` does the right thing transparently:

1. Check the cached SP-token at `~/.config/apes/sp-tokens/plans.openape.ai.json`. Return it if still valid.
2. Otherwise, ensure the IdP token is fresh — refresh via OIDC if expired (rotates the stored `refresh_token` server-side).
3. POST the IdP token to `https://plans.openape.ai/api/cli/exchange`. The SP verifies it via JWKS against `id.openape.ai`, applies its own policies, and mints a 30-day SP-scoped HS256 token with `aud=plans.openape.ai`.
4. Cache the SP-token for next time.

If anything fails the user gets a clear "Run `apes login` again" message — never silent 401 spam.

## Public API

```ts
// One-shot helper for nearly every consumer.
getAuthorizedBearer(opts: {
  endpoint: string
  aud: string
  scopes?: string[]
  forceRefresh?: boolean
}): Promise<string>  // 'Bearer <jwt>'

// Lower-level building blocks.
ensureFreshIdpAuth(now?: number): Promise<IdpAuth>
exchangeForSpToken(idpAuth: IdpAuth, request: ExchangeRequest, now?: number): Promise<SpToken>

// Storage primitives.
loadIdpAuth(): IdpAuth | null
saveIdpAuth(auth: IdpAuth): void
clearIdpAuth(): void

loadSpToken(aud: string): SpToken | null
saveSpToken(token: SpToken): void
clearSpToken(aud: string): void
clearAllSpTokens(): void

// Path inspection.
getConfigDir(): string  // ~/.config/apes/
getAuthFile(): string   // ~/.config/apes/auth.json
getSpTokensDir(): string // ~/.config/apes/sp-tokens/

// Errors.
AuthError, NotLoggedInError, type IdpAuth, type SpToken
```

## File layout

```
~/.config/apes/
├── auth.json                       # IdP access + refresh tokens (managed by apes login/logout)
└── sp-tokens/
    ├── plans.openape.ai.json       # SP-scoped tokens, one per audience
    ├── tasks.openape.ai.json
    └── secrets.openape.ai.json
```

All files are written with mode 0600. Directories with mode 0700.

## Coexistence with `@openape/apes`

This package shares `~/.config/apes/auth.json` with `@openape/apes`, which is the canonical IdP-token writer (`apes login` writes; `apes logout` clears). Both packages agree on the JSON schema:

```json
{
  "idp": "https://id.openape.ai",
  "access_token": "eyJ...",
  "refresh_token": "rt-abc",
  "email": "patrick@hofmann.eco",
  "expires_at": 1727000000
}
```

`@openape/cli-auth` is intentionally **read-mostly** for `auth.json` — the only write is via `ensureFreshIdpAuth` after a successful refresh, which preserves all other fields and just bumps `access_token` + `refresh_token` + `expires_at`. SP-tokens live in their own subdirectory and are managed exclusively here.

## Testing

```bash
pnpm --filter @openape/cli-auth test
```

Tests use `OPENAPE_CLI_AUTH_HOME` env override to redirect storage to a temp dir per test case.

## License

MIT — part of the OpenApe project.
