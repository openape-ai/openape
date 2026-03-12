# @openape/grants

Grant lifecycle management for OpenApe. Grants control what actions agents (or humans) are authorized to perform on behalf of a user — from one-time approvals to time-limited or permanent permissions.

## Installation

```bash
npm install @openape/grants
```

Peer dependency: `@openape/core`

## Grant Lifecycle

```
create → [pending] → approve → [approved] → use / revoke
                    → deny    → [denied]
                                [approved] → revoke → [revoked]
                                [approved] → (time)  → [expired]
```

## API

### Grant Functions

- `createGrant(request, store)` — Create a new grant request (status: `pending`)
- `approveGrant(grantId, approver, store)` — Approve a pending grant
- `denyGrant(grantId, denier, store)` — Deny a pending grant
- `revokeGrant(grantId, store)` — Revoke an approved grant
- `introspectGrant(grantId, store)` — Look up a grant by ID
- `useGrant(grantId, store)` — Mark a `once` grant as used

### Authorization JWT

- `issueAuthzJWT(payload, privateKey, kid?)` — Issue a signed authorization JWT for an approved grant
- `verifyAuthzJWT(token, keyOrJWKS, options?)` — Verify an authorization JWT

## GrantStore Interface

```typescript
interface GrantStore {
  save(grant: OpenApeGrant): Promise<void>
  findById(id: string): Promise<OpenApeGrant | null>
  updateStatus(id: string, status: GrantStatus, extra?: Partial<OpenApeGrant>): Promise<void>
  findByRequester(requester: string): Promise<OpenApeGrant[]>
  findByStatus(status: GrantStatus): Promise<OpenApeGrant[]>
}
```

An `InMemoryGrantStore` is included for development and testing.

## Grant Types

| Type | Behavior |
|------|----------|
| `once` | Valid for a single use, then automatically marked as `used` |
| `timed` | Valid for a duration (in seconds), then automatically `expired` |
| `always` | Valid until explicitly revoked |

## Example

```typescript
import { createGrant, approveGrant, issueAuthzJWT, InMemoryGrantStore } from '@openape/grants'
import { generateKeyPair } from '@openape/core'

const store = new InMemoryGrantStore()

// 1. Agent requests a grant
const grant = await createGrant({
  requester: 'agent@example.com',
  target: 'api.github.com',
  grant_type: 'once',
  permissions: ['write:issues'],
  reason: 'Create issue for bug report',
}, store)

// 2. User approves the grant
const approved = await approveGrant(grant.id, 'user@example.com', store)

// 3. IdP issues an authorization JWT
const { privateKey } = await generateKeyPair()
const authzToken = await issueAuthzJWT({
  iss: 'https://id.example.com',
  sub: 'agent@example.com',
  aud: 'api.github.com',
  grant_id: approved.id,
  grant_type: 'once',
  permissions: ['write:issues'],
}, privateKey, 'key-1')
```

## License

[AGPL-3.0-or-later](./LICENSE)
