---
name: openape-sp
description: Integrate DDISA login into a Nuxt app using the @openape/nuxt-auth-sp Service Provider module. Use when adding passwordless authentication via OpenApe IdP with DNS discovery, PKCE, and grant-based authorization.
metadata:
  openclaw:
    emoji: "\U0001F310"
    requires:
      env:
        - NUXT_SESSION_SECRET
---

# OpenApe Service Provider (Nuxt Module)

Nuxt module that adds DDISA-based authentication to any Nuxt app. Users log in with their email — the SP discovers their IdP via DNS, performs a PKCE OAuth flow, and establishes an authenticated session.

## Installation

```bash
pnpm add @openape/nuxt-auth-sp
```

## nuxt.config.ts Setup

```typescript
export default defineNuxtConfig({
  modules: ['@openape/nuxt-auth-sp'],

  openapeSp: {
    clientId: 'myapp.example.com',                 // Your SP identifier (typically domain)
    spName: 'My Application',                      // Display name shown during authorization
    sessionSecret: process.env.NUXT_SESSION_SECRET, // Min 32 chars, required in production
  },
})
```

## Module Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `clientId` | string | `localhost:3000` (dev) | SP identifier |
| `spName` | string | `OpenApe Service Provider` | Display name on authorization screen |
| `sessionSecret` | string | auto (dev only) | Session encryption key (min 32 chars) |
| `openapeUrl` | string | — | Override IdP URL (bypasses DNS discovery) |
| `fallbackIdpUrl` | string | `https://id.openape.at` | Fallback when no DNS record found |
| `routes` | boolean | `true` | Enable automatic route registration |
| `manifest` | object | — | Extended SP manifest config (see below) |

## DNS Discovery Flow

1. User enters their email (e.g. `user@example.com`)
2. SP extracts the domain (`example.com`)
3. SP queries DNS TXT record: `_ddisa.example.com`
4. Expected record format: `v=ddisa1 idp=https://idp.example.com`
5. If no record found → uses `fallbackIdpUrl`
6. SP initiates PKCE OAuth flow with discovered IdP

**To register your domain:** Add a DNS TXT record:
```
_ddisa.example.com  TXT  "v=ddisa1 idp=https://id.openape.at"
```

## Provided Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/login` | Start login flow (body: `{ email }`) |
| GET | `/api/callback` | OAuth callback handler |
| POST | `/api/logout` | Clear session |
| GET | `/api/me` | Get current user claims (401 if not authenticated) |
| GET | `/.well-known/sp-manifest.json` | SP metadata (OIDC compliant) |
| GET | `/.well-known/openape.json` | Extended SP manifest with CORS |
| GET | `/.well-known/auth.md` | Human-readable auth documentation |

Disable with `routes: false` to register your own handlers.

## PKCE Callback Handling

The callback flow (`/api/callback`):

1. Receives `code` and `state` from IdP redirect
2. Validates `state` against encrypted session cookie (`openape-flow`, 10min TTL)
3. Exchanges code for tokens using PKCE code verifier
4. Extracts DDISA assertion claims
5. Stores claims in encrypted session cookie (`openape-sp`)
6. Redirects to `/dashboard`

On error → redirects to `/?error=<message>`.

## Middleware

Protect pages with the `openape-auth` middleware:

```vue
<script setup>
definePageMeta({
  middleware: 'openape-auth',
})
</script>
```

The middleware fetches `/api/me` on first load and redirects to `/` if not authenticated.

## useOpenApeAuth() Composable

```typescript
const { user, loading, fetchUser, login, logout } = useOpenApeAuth()
```

| Property | Type | Description |
|----------|------|-------------|
| `user` | `Ref<DDISAAssertionClaims \| null>` | Current user claims |
| `loading` | `Ref<boolean>` | True during initial fetch |
| `fetchUser()` | `async () => void` | Fetch `/api/me`, update `user` |
| `login(email)` | `async (string) => void` | Start login flow, redirect to IdP |
| `logout()` | `async () => void` | Clear session, redirect to `/` |

**User claims include:** `sub` (email), `iss` (IdP URL), `aud` (clientId), `iat`, `exp`, `act` (delegation actor).

## OpenApeAuth Component

Built-in login form component:

```vue
<template>
  <OpenApeAuth
    title="Sign in"
    subtitle="Enter your email to continue"
    button-text="Continue"
    placeholder="you@example.com"
    @error="handleError"
  />
</template>
```

**Slots:** `#header`, `#error` (receives `{ error }`), `#button` (receives `{ submitting }`), `#footer`.

## Server Utilities

Available in server routes via auto-import:

```typescript
// Session access
const session = await getSpSession(event)
const claims = session.data.claims

// Grant utilities
await hasGrant(event, 'action-name')        // Check if session has grant
await findGrant(event, 'action-name')        // Get specific grant detail
await consumeGrant(event, grantId)           // Consume once-grant via IdP
await isDelegated(event)                     // Check if acting via delegation
await getActor(event)                        // Get delegate's sub
await getSubject(event)                      // Get delegator's sub
```

## SP Manifest

Configure the extended manifest for service discovery:

```typescript
openapeSp: {
  manifest: {
    service: {
      name: 'My App',
      description: 'Application description',
      privacy_policy: 'https://example.com/privacy',
      terms: 'https://example.com/terms',
    },
    scopes: {
      'read:data': {
        name: 'Read Data',
        description: 'Read your stored data',
        risk: 'low',
      },
      'write:data': {
        name: 'Write Data',
        description: 'Modify your stored data',
        risk: 'medium',
      },
    },
    policies: {
      delegation: 'allowed',
      max_delegation_duration: '30d',
    },
  },
}
```

## Environment Variables

| Variable | Maps to | Description |
|----------|---------|-------------|
| `NUXT_OPENAPE_SP_CLIENT_ID` | `openapeSp.clientId` | SP identifier |
| `NUXT_OPENAPE_SP_SESSION_SECRET` | `openapeSp.sessionSecret` | Session key |
| `NUXT_OPENAPE_SP_SP_NAME` | `openapeSp.spName` | Display name |
| `NUXT_OPENAPE_SP_OPENAPE_URL` | `openapeSp.openapeUrl` | Override IdP URL |
| `NUXT_OPENAPE_SP_FALLBACK_IDP_URL` | `openapeSp.fallbackIdpUrl` | Fallback IdP |

## Troubleshooting

- **IdP not found** — Verify DNS TXT record at `_ddisa.<domain>`. Use `dig TXT _ddisa.example.com` to check. Set `fallbackIdpUrl` for domains without records.
- **Session issues** — Ensure `sessionSecret` is stable across restarts (not auto-generated). Must be at least 32 characters.
- **Callback errors** — The flow state cookie expires after 10 minutes. If login takes longer, the callback will fail.
- **CORS on manifests** — `/.well-known/openape.json` has CORS headers; `sp-manifest.json` does not.
- **Missing user** — The middleware redirects to `/` if not authenticated. Ensure `/api/me` returns 401 (not 500) for unauthenticated requests.
