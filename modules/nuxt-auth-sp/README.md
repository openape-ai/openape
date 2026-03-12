# @openape/nuxt-auth-sp

Nuxt module that adds **DDISA-based login** to your application. Users enter their email, the module discovers their Identity Provider via DNS, and handles the full authorization flow — no pre-configured IdP list needed.

## Installation

```bash
npm install @openape/nuxt-auth-sp
```

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@openape/nuxt-auth-sp'],

  openapeSp: {
    clientId: 'sp.example.com',
    spName: 'My Service',
    sessionSecret: 'your-secret-min-32-chars...',
  },
})
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `clientId` | `string` | — | **Required.** Service Provider identifier (typically your domain) |
| `spName` | `string` | `'OpenApe Service Provider'` | Display name shown during authorization |
| `sessionSecret` | `string` | `'change-me-sp-secret-...'` | Session encryption key |
| `openapeUrl` | `string` | — | Override IdP URL (bypasses DNS discovery) |

## Routes

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/login` | Start login — `{ email }` → `{ redirectUrl }` |
| `GET` | `/api/callback` | Handle callback from IdP |
| `POST` | `/api/logout` | End session |
| `GET` | `/api/me` | Get current user (`DDISAAssertionClaims`) |
| `GET` | `/.well-known/sp-manifest.json` | SP manifest for IdP discovery |

## Composables

### `useOpenApeAuth()`

```typescript
const { user, loading, fetchUser, login, logout } = useOpenApeAuth()

// user: Ref<DDISAAssertionClaims | null>
// DDISAAssertionClaims: { sub, iss, aud, act, iat, exp, nonce, ... }

await login('user@example.com')  // Redirects to user's IdP
await logout()                   // Clears session, navigates to /
```

## Middleware

The module provides an `openape-auth` middleware that protects pages from unauthenticated access.

```typescript
// pages/dashboard.vue
definePageMeta({
  middleware: 'openape-auth',
})
```

Unauthenticated users are redirected to the login page.

## DNS Discovery

When a user logs in with `user@example.com`, the module:

1. Extracts the domain (`example.com`)
2. Looks up the `_ddisa.example.com` TXT record
3. Parses the DDISA record to find the IdP URL
4. Redirects the user to the IdP's authorization endpoint with PKCE
5. Handles the callback and validates the signed assertion

This means any domain with a DDISA DNS record can authenticate — no pre-registration needed.

For details on DNS resolution, see [`@openape/core`](../core).

## Quick Start

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@openape/nuxt-auth-sp'],

  openapeSp: {
    clientId: 'localhost:3001',
    spName: 'My App',
    sessionSecret: 'at-least-32-characters-long-secret-here',
  },
})
```

```vue
<!-- pages/index.vue -->
<script setup>
const { user, login, logout } = useOpenApeAuth()
const email = ref('')
</script>

<template>
  <div v-if="user">
    Logged in as {{ user.sub }}
    <button @click="logout">Logout</button>
  </div>
  <form v-else @submit.prevent="login(email)">
    <input v-model="email" type="email" placeholder="you@example.com" />
    <button type="submit">Login</button>
  </form>
</template>
```

See the [examples](../examples) directory for a fully working SP setup.

## License

[AGPL-3.0-or-later](./LICENSE)
