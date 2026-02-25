# OpenApe IdP Example

Identity Provider example built with [Nuxt](https://nuxt.com/) and the `@openape/nuxt-auth-idp` + `@openape/nuxt-grants` modules.

Provides WebAuthn (passkey) registration and authentication, an OIDC authorization server, and a grant management UI.

## Quick Start

```bash
pnpm install

# Set a management token to enable the admin API
NUXT_OPENAPE_MANAGEMENT_TOKEN=my-token pnpm dev
```

The IdP is now running at **http://localhost:3000**.

### Create the First User

With no users registered yet, you need the management API to create a registration URL:

```bash
NUXT_OPENAPE_MANAGEMENT_TOKEN=my-token node create-registration-url.js demo@example.com "Demo User"
```

Open the printed URL in your browser and register a passkey. You can now log in at `/login`.

> **Tip:** To make a user an admin, add their email to `NUXT_OPENAPE_ADMIN_EMAILS`.

## Pages

| Path | Description |
|------|-------------|
| `/` | Home — shows login status and navigation |
| `/login` | WebAuthn login (provided by module) |
| `/register?token=...` | Passkey registration with a one-time token (provided by module) |
| `/account` | Account settings (provided by module) |
| `/admin` | Admin dashboard — user management (requires admin) |
| `/grants` | Grant management UI (provided by `@openape/nuxt-grants`) |

## OIDC Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/authorize` | OIDC authorization endpoint |
| `POST` | `/token` | OIDC token endpoint |
| `GET` | `/.well-known/jwks.json` | JSON Web Key Set |

## Admin API

Requires `Authorization: Bearer <NUXT_OPENAPE_MANAGEMENT_TOKEN>`. Disabled when the token is empty (default).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/registration-urls` | List all registration URLs |
| `POST` | `/api/admin/registration-urls` | Create a registration URL |
| `DELETE` | `/api/admin/registration-urls/:token` | Delete a registration URL |

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `NUXT_OPENAPE_MANAGEMENT_TOKEN` | `''` (disabled) | Bearer token for the admin API |
| `NUXT_OPENAPE_ADMIN_EMAILS` | `''` | Comma-separated list of admin email addresses |
| `NUXT_OPENAPE_SESSION_SECRET` | `'change-me-...'` | Session signing secret (min 32 chars) |
| `NUXT_OPENAPE_RP_NAME` | `'OpenApe Identity'` | Relying party display name |
| `NUXT_OPENAPE_RP_ID` | `'localhost'` | Relying party ID (domain) |
| `NUXT_OPENAPE_RP_ORIGIN` | `'http://localhost:3000'` | Relying party origin URL |
| `NUXT_OPENAPE_ISSUER` | `''` | OIDC issuer URL |
| `NUXT_OPENAPE_STORAGE_DRIVER` | `''` | Storage driver (`''` = filesystem) |
| `NUXT_OPENAPE_STORAGE_PATH` | `./.data/openape-idp-db` | Filesystem storage path |
| `NUXT_OPENAPE_REQUIRE_USER_VERIFICATION` | `false` | Require WebAuthn user verification |
| `NUXT_OPENAPE_RESIDENT_KEY` | `'preferred'` | WebAuthn resident key preference |
| `NUXT_OPENAPE_ATTESTATION_TYPE` | `'none'` | WebAuthn attestation type |

## Known Pitfalls

1. **Vercel env var caching:** `vercel build --prod` caches env vars in `.vercel/.env.production.local`. After deleting/changing Vercel env vars, delete this file before rebuilding — otherwise stale values get baked into the build.
2. **Nitro env var mapping:** Nitro uses `snakeCase()` on the full config path. For `openapeIdp.sessionSecret` Nitro looks for `NUXT_OPENAPE_IDP_SESSION_SECRET` at runtime. Set env vars in `nuxt.config.ts` via `process.env` explicitly to avoid surprises.
