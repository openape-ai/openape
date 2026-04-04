# @openape/server

Programmatic DDISA Identity Provider and Service Provider built on h3. Start a full IdP or SP with one function call — ideal for testing, lightweight deployments, and framework-agnostic integration.

## Quick Start

```typescript
import { createIdPApp } from '@openape/server'

const { app, stores } = createIdPApp({
  issuer: 'https://id.example.com',
  managementToken: 'your-secret-token',
  sessionSecret: 'at-least-32-characters-for-cookie-encryption!',
})

// Pre-fill a user
await stores.userStore.create({
  email: 'alice@example.com',
  name: 'Alice',
  isActive: true,
  createdAt: Date.now(),
})
```

Deploy with any Node.js server:

```typescript
import { createServer } from 'node:http'
import { toNodeHandler } from 'h3'

createServer(toNodeHandler(app)).listen(3000)
```

## SP (Service Provider)

```typescript
import { createSPApp } from '@openape/server'

const { app } = createSPApp({
  clientId: 'sp.example.com',
  redirectUri: 'https://sp.example.com/callback',
})
```

## IdP Endpoints

### Authentication
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/challenge` | None | Request ed25519 challenge |
| POST | `/api/auth/authenticate` | None | Authenticate with signed challenge, returns JWT |
| POST | `/api/auth/enroll` | Bearer (human) or Management Token | Register a sub-user with SSH key |
| POST | `/api/session/login` | None | Session login (sets cookie) |
| POST | `/api/session/logout` | Session | Clear session cookie |

### OIDC
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/authorize` | Bearer or Session | OIDC authorize (redirects with code) |
| POST | `/token` | None | Exchange code for assertion JWT |
| GET | `/.well-known/jwks.json` | None | Public keys |
| GET | `/.well-known/openid-configuration` | None | OIDC Discovery |

### Grants
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/grants` | Bearer | List grants |
| POST | `/api/grants` | Bearer | Request a grant |
| GET | `/api/grants/:id` | Bearer | Get grant details |
| POST | `/api/grants/:id/approve` | Bearer | Approve grant |
| POST | `/api/grants/:id/deny` | Bearer | Deny grant |
| POST | `/api/grants/:id/revoke` | Bearer | Revoke grant |
| POST | `/api/grants/:id/token` | Bearer | Get AuthZ-JWT |
| POST | `/api/grants/:id/consume` | Bearer | Mark grant as used |
| POST | `/api/grants/batch` | Bearer | Batch operations |

### Delegations
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/delegations` | Bearer (human only) | Create delegation |
| GET | `/api/delegations` | Bearer | List delegations |
| DELETE | `/api/delegations/:id` | Bearer (delegator only) | Revoke delegation |
| POST | `/api/delegations/:id/validate` | None | Validate delegation |

### Admin
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/users` | Management Token | List users |
| POST | `/api/admin/users` | Management Token | Create user |
| DELETE | `/api/admin/users/:email` | Management Token | Delete user + keys |
| GET | `/api/admin/users/:email/ssh-keys` | Management Token | List SSH keys |
| POST | `/api/admin/users/:email/ssh-keys` | Management Token | Add SSH key |
| DELETE | `/api/admin/users/:email/ssh-keys/:keyId` | Management Token | Delete SSH key |

## Security

### Headers
All responses include: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cache-Control: no-store` (except JWKS/Discovery which are cacheable).

### CORS
Enabled for API endpoints (`/api/auth/*`, `/api/grants/*`, `/api/delegations/*`, `/.well-known/*`, `/token`). Disabled for admin and session endpoints.

### Cookies
Session cookies: `HttpOnly`, `SameSite=Lax`, `MaxAge=7d`, `Secure` only when issuer is HTTPS.

### Rate Limiting
Opt-in, in-memory, per-IP. Configure via `rateLimitConfig`:

```typescript
createIdPApp({
  issuer: 'https://id.example.com',
  rateLimitConfig: {
    maxRequests: 10,   // per window
    windowMs: 60_000,  // 1 minute
  },
})
```

Rate-limited paths: `/api/auth/challenge`, `/api/auth/authenticate`, `/api/auth/enroll`, `/api/session/login`.

### Input Validation
- Body size limit: 100KB
- Email/name: max 255 characters
- Public key: max 1000 characters

### Cryptography
- ed25519 challenge-response (32 bytes, 60s TTL, single-use)
- PKCE S256 with code single-use enforcement
- JWT signed with EdDSA, verified with issuer + audience checks
- Management token comparison uses `crypto.timingSafeEqual`

## Configuration

```typescript
interface IdPConfig {
  issuer: string                 // Required. IdP URL (e.g. https://id.example.com)
  managementToken?: string       // Admin API authentication
  adminEmails?: string[]         // Emails with admin privileges
  sessionSecret?: string         // Cookie encryption (min 32 chars)
  rateLimitConfig?: {
    maxRequests?: number         // Default: 10
    windowMs?: number            // Default: 60000 (1 min)
    paths?: string[]             // Default: auth endpoints
  }
}
```

## Stores

All data is in-memory by default. Override with custom store implementations:

```typescript
createIdPApp({
  issuer: '...',
  stores: {
    userStore: myDrizzleUserStore,
    sshKeyStore: myDrizzleSshKeyStore,
    // ... other stores
  },
})
```

Store interfaces are defined in `@openape/auth`.

## Testing

```typescript
import { createIdPApp } from '@openape/server'

const { app, stores } = createIdPApp({ issuer: 'http://localhost:3000' })

// Pre-fill test data
await stores.userStore.create({ email: 'test@example.com', name: 'Test', isActive: true, createdAt: Date.now() })

// Test with fetch against toNodeHandler(app)
```
