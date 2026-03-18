# @openape/nuxt-auth-idp

Nuxt module that turns your application into an OpenApe **Identity Provider**. Adds WebAuthn-based user authentication, DDISA authorization endpoints, admin management, and agent support — all auto-configured via the module.

## Installation

```bash
npm install @openape/nuxt-auth-idp
```

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@openape/nuxt-auth-idp'],

  openapeIdp: {
    sessionSecret: 'your-secret-min-32-chars...',
    managementToken: 'admin-api-token',
    adminEmails: 'admin@example.com',
    issuer: 'https://id.example.com',
    rpName: 'My Identity Provider',
    rpID: 'id.example.com',
    rpOrigin: 'https://id.example.com',
  },
})
```

## Configuration

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sessionSecret` | `string` | — | **Required.** Session encryption key (min 32 chars) |
| `managementToken` | `string` | — | Token for admin API access |
| `adminEmails` | `string` | — | Comma-separated list of admin email addresses |
| `storageDriver` | `string` | `'memory'` | Storage backend: `'memory'`, `'fs'`, `'s3'` |
| `storagePath` | `string` | `'./.data/openape-idp-db'` | Path for `fs` storage driver |
| `issuer` | `string` | — | JWT issuer URL |
| `rpName` | `string` | — | WebAuthn relying party display name |
| `rpID` | `string` | — | WebAuthn relying party ID (domain) |
| `rpOrigin` | `string` | — | WebAuthn expected origin |
| `requireUserVerification` | `boolean` | `false` | Require biometric/PIN for WebAuthn |
| `residentKey` | `string` | `'preferred'` | `'preferred'`, `'required'`, or `'discouraged'` |
| `attestationType` | `string` | `'none'` | `'none'`, `'indirect'`, `'direct'`, or `'enterprise'` |

### S3 Storage

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `s3.accessKeyId` | `string` | — | S3 access key |
| `s3.secretAccessKey` | `string` | — | S3 secret key |
| `s3.bucket` | `string` | `'dnsid'` | Bucket name |
| `s3.endpoint` | `string` | `'https://sos-at-vie-2.exo.io'` | S3 endpoint |
| `s3.region` | `string` | `'at-vie-2'` | S3 region |
| `s3.prefix` | `string` | `'openape-idp/'` | Key prefix |

## Routes

### Auth

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/logout` | End session |
| `GET` | `/api/me` | Get current user |

### WebAuthn Registration

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/webauthn/register/options` | Get registration options |
| `POST` | `/api/webauthn/register/verify` | Verify registration response |

### WebAuthn Login

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/webauthn/login/options` | Get authentication options |
| `POST` | `/api/webauthn/login/verify` | Verify authentication response |

### WebAuthn Credentials

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/webauthn/credentials` | List user's credentials |
| `POST` | `/api/webauthn/credentials/add/options` | Get options for adding a device |
| `POST` | `/api/webauthn/credentials/add/verify` | Verify new device registration |
| `DELETE` | `/api/webauthn/credentials/:id` | Remove a credential |

### DDISA Authorization

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/authorize` | Authorization endpoint |
| `POST` | `/token` | Token exchange endpoint |
| `GET` | `/.well-known/jwks.json` | Public key set |

### Admin — Users

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/users` | List all users |
| `POST` | `/api/admin/users` | Create a user |
| `DELETE` | `/api/admin/users/:email` | Delete a user |
| `GET` | `/api/admin/users/:email/credentials` | List user's credentials |

### Admin — Agents

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/agents` | List all agents |
| `POST` | `/api/admin/agents` | Create an agent |
| `GET` | `/api/admin/agents/:id` | Get agent details |
| `PUT` | `/api/admin/agents/:id` | Update an agent |
| `DELETE` | `/api/admin/agents/:id` | Delete an agent |

### Admin — Registration URLs

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/registration-urls` | List registration URLs |
| `POST` | `/api/admin/registration-urls` | Create a registration URL |
| `DELETE` | `/api/admin/registration-urls/:token` | Delete a registration URL |

## Pages

The module auto-generates the following pages (overridable by placing your own in `pages/`):

| Path | Description |
|------|-------------|
| `/login` | User login with passkey |
| `/register` | New user registration via registration URL |
| `/account` | Device management (add/remove passkeys) |
| `/admin` | Admin panel for users, agents, and registration URLs |

## Composables

### `useIdpAuth()`

```typescript
const { user, loading, fetchUser, logout } = useIdpAuth()
// user: Ref<{ email: string, name: string, isAdmin: boolean } | null>
```

### `useWebAuthn()`

```typescript
const { error, loading, registerWithToken, login, addDevice } = useWebAuthn()

await registerWithToken(token, deviceName?)  // → { ok, email, name }
await login(email?)                          // → { ok, email, name }
await addDevice(deviceName?)                 // → { ok, credentialId }
```

## Storage

| Driver | Use case |
|--------|----------|
| `memory` | Development only — data is lost on restart |
| `fs` | Single-server deployments — persists to `storagePath` |
| `s3` | Production — S3-compatible object storage |

## Quick Start

Minimal configuration to get a local IdP running:

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@openape/nuxt-auth-idp'],

  openapeIdp: {
    sessionSecret: 'at-least-32-characters-long-secret-here',
    managementToken: 'dev-token',
    adminEmails: 'you@example.com',
    issuer: 'http://localhost:3000',
    rpName: 'Local IdP',
    rpID: 'localhost',
    rpOrigin: 'http://localhost:3000',
  },
})
```

See the [examples](../examples) directory for a fully working IdP setup.

## License

[MIT](./LICENSE)
