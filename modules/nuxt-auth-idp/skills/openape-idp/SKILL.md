---
name: openape-idp
description: Set up and configure an OpenApe Identity Provider using the @openape/nuxt-auth-idp Nuxt module. Use when building an IdP that manages WebAuthn passkeys, OAuth/OIDC flows, grants, and agent enrollment.
metadata:
  openclaw:
    emoji: "\U0001F511"
    requires:
      env:
        - NUXT_SESSION_SECRET
---

# OpenApe Identity Provider (Nuxt Module)

Nuxt module that turns any Nuxt app into a full DDISA-compliant Identity Provider with WebAuthn passkeys, OAuth 2.0/OIDC, grant management, and agent enrollment.

## Installation

```bash
pnpm add @openape/nuxt-auth-idp
```

## nuxt.config.ts Setup

```typescript
export default defineNuxtConfig({
  modules: ['@openape/nuxt-auth-idp'],

  openapeIdp: {
    sessionSecret: process.env.NUXT_SESSION_SECRET,   // min 32 chars, required in production
    rpName: 'My Identity Provider',                     // WebAuthn relying party name
    rpID: 'id.example.com',                             // WebAuthn relying party ID (domain)
    rpOrigin: 'https://id.example.com',                 // WebAuthn origin URL
    adminEmails: 'admin@example.com',                   // Comma-separated admin emails
    managementToken: process.env.MANAGEMENT_TOKEN,      // API token for management access
    issuer: 'https://id.example.com',                   // OAuth issuer (defaults to NUXT_PUBLIC_SITE_URL)
  },

  nitro: {
    storage: {
      'openape-idp': { driver: 'fsLite', base: './.data/openape-idp' },
      'openape-grants': { driver: 'fsLite', base: './.data/openape-grants' },
    },
  },
})
```

## Module Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sessionSecret` | string | auto (dev only) | Session encryption key (min 32 chars) |
| `rpName` | string | — | WebAuthn relying party display name |
| `rpID` | string | — | WebAuthn relying party ID (domain) |
| `rpOrigin` | string | — | WebAuthn allowed origin |
| `adminEmails` | string | — | Comma-separated admin email addresses |
| `managementToken` | string | — | Bearer token for admin API access |
| `issuer` | string | `NUXT_PUBLIC_SITE_URL` | OAuth issuer URL |
| `storageKey` | string | `openape-idp` | Nitro storage key for IdP data |
| `requireUserVerification` | boolean | `false` | WebAuthn user verification |
| `residentKey` | string | `preferred` | `preferred`, `required`, or `discouraged` |
| `attestationType` | string | `none` | `none`, `indirect`, `direct`, or `enterprise` |
| `grants.enablePages` | boolean | `true` | Enable grant management pages |
| `grants.storageKey` | string | `openape-grants` | Nitro storage key for grants |
| `routes` | boolean/object | `true` | Enable/disable route groups |
| `pages` | boolean | `true` | Enable built-in pages |
| `federationProviders` | string | — | JSON string of OIDC federation providers |

### Selective Route Groups

```typescript
openapeIdp: {
  routes: {
    auth: true,     // WebAuthn login/register, /logout, /me
    oauth: true,    // /authorize, /token, /revoke, /.well-known/*
    grants: true,   // /api/grants/* endpoints
    admin: true,    // /api/admin/* endpoints
    agent: true,    // /api/agent/* endpoints
  },
}
```

## Storage Drivers

Configure via `nitro.storage` in nuxt.config.ts:

```typescript
// Development (in-memory)
'openape-idp': { driver: 'memory' }

// File-based
'openape-idp': { driver: 'fsLite', base: './.data/openape-idp' }

// S3-compatible
'openape-idp': { driver: '@openape/unstorage-s3-driver', bucket: 'my-bucket', prefix: 'idp/' }
```

## Provided Routes

### OAuth/OIDC
- `GET /authorize` — OAuth authorization endpoint
- `POST /token` — Token exchange (authorization_code, refresh_token, client_credentials)
- `POST /revoke` — Token revocation
- `GET /.well-known/openid-configuration` — OIDC discovery
- `GET /.well-known/jwks.json` — JSON Web Key Set

### Authentication
- `POST /api/logout` — Logout (clears session)
- `GET /api/me` — Current user info (email, name, isAdmin)

### WebAuthn
- `POST /api/webauthn/register/options` — Registration challenge
- `POST /api/webauthn/register/verify` — Verify registration
- `POST /api/webauthn/login/options` — Authentication challenge
- `POST /api/webauthn/login/verify` — Verify authentication
- `GET /api/webauthn/credentials` — List credentials
- `POST /api/webauthn/credentials/add/options` — Add device challenge
- `POST /api/webauthn/credentials/add/verify` — Verify new device
- `DELETE /api/webauthn/credentials/:id` — Remove credential

### Grants
- `GET /api/grants` — List grants
- `POST /api/grants` — Create grant
- `GET /api/grants/:id` — Get grant details
- `POST /api/grants/:id/approve` — Approve grant
- `POST /api/grants/:id/deny` — Deny grant
- `POST /api/grants/:id/revoke` — Revoke grant
- `POST /api/grants/:id/token` — Issue grant token (JWT)
- `POST /api/grants/:id/consume` — Consume single-use grant
- `POST /api/grants/verify` — Verify grant JWT

### Delegations
- `GET /api/delegations` — List delegations
- `POST /api/delegations` — Create delegation
- `DELETE /api/delegations/:id` — Revoke delegation

### Agent
- `POST /api/agent/challenge` — Get authentication challenge
- `POST /api/agent/authenticate` — Authenticate with challenge signature
- `POST /api/agent/enroll` — Enroll new agent (admin)

### Admin (requires `adminEmails` or `managementToken`)
- `GET/POST /api/admin/users` — List/create users
- `DELETE /api/admin/users/:email` — Delete user
- `GET /api/admin/users/:email/credentials` — User's credentials
- `GET/POST /api/admin/agents` — List/create agents
- `GET/PUT/DELETE /api/admin/agents/:id` — Agent CRUD
- `GET /api/admin/sessions` — List sessions
- `DELETE /api/admin/sessions/:familyId` — Logout session family
- `DELETE /api/admin/sessions/user/:email` — Logout user
- `GET/POST /api/admin/registration-urls` — Registration URL management
- `DELETE /api/admin/registration-urls/:token` — Delete registration URL

### Federation (OIDC)
- `GET /auth/federated/:providerId` — Initiate federated login
- `GET /auth/federated/:providerId/callback` — Federation callback
- `GET /api/federation/providers` — List providers

## Built-in Pages

| Path | Purpose |
|------|---------|
| `/login` | WebAuthn login with federation support |
| `/register` | User registration |
| `/account` | Profile & credential management |
| `/admin` | Admin dashboard |
| `/grants` | Grant management |
| `/grant-approval` | Grant approval UI |
| `/enroll` | Agent enrollment |

Disable with `pages: false` to provide your own.

## Composables

### useIdpAuth()

```typescript
const { user, loading, fetchUser, logout } = useIdpAuth()
// user: Ref<{ email, name, isAdmin } | null>
// loading: Ref<boolean>
// fetchUser(): Promise<void>   — fetches /api/me
// logout(): Promise<void>      — clears session
```

### useWebAuthn()

```typescript
const { error, loading, registerWithToken, login, addDevice } = useWebAuthn()
// registerWithToken(token, deviceName?): Promise<{ ok, email, name }>
// login(email?): Promise<{ ok, email, name }>
// addDevice(deviceName?): Promise<{ ok, credentialId }>
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NUXT_SESSION_SECRET` | Session encryption key (required in production) |
| `NUXT_PUBLIC_SITE_URL` | Used as default issuer URL |
| `MANAGEMENT_TOKEN` | Bearer token for admin API |

## Multi-Tenant Support

Override per-request via H3 event context:

```typescript
event.context.openapeStorageKey = 'tenant-abc-idp'
event.context.openapeIssuer = 'https://tenant-abc.example.com'
event.context.openapeAdminEmails = 'admin@tenant-abc.com'
event.context.openapeTenantSlug = 'tenant-abc'
event.context.openapeFederationProviders = [...]
```

## Troubleshooting

- **Auto-imports in module pages** — Pages in `src/runtime/pages/` must explicitly import from `#imports` (e.g. `useIdpAuth`, `useRoute`, `navigateTo`). Vue APIs must be imported from `vue`. `$fetch` is a global — do NOT import from `#imports`.
- **Storage errors** — Ensure `nitro.storage` keys match `storageKey` and `grants.storageKey` config values.
- **WebAuthn fails** — Verify `rpID` matches the domain and `rpOrigin` includes the protocol (e.g. `https://`).
- **CORS issues** — Only `/.well-known/**`, `/token`, `/api/grants/**`, and `/api/agent/**` have CORS enabled.
