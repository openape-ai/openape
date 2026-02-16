# @ddisa/core

Shared foundation for DDISA and ClawGate — types, DNS resolution, JWT/PKCE cryptography, and validation.

## Installation

```bash
npm install @ddisa/core
```

## API

### DNS Resolution

```typescript
import { resolveDDISA, parseDDISATXT } from '@ddisa/core'

// Resolve DDISA record for a domain (auto-detects runtime: Node DNS, DoH, or mock)
const record = await resolveDDISA('example.com')
// => { idp: 'https://idp.example.com', mode: 'allowlist-user', v: 'ddisa1' }

// Parse a raw TXT string
const parsed = parseDDISATXT('v=ddisa1 idp=https://idp.example.com mode=open')
```

### JWT & Cryptography

```typescript
import { signJWT, verifyJWT, generateKeyPair, exportPublicKeyJWK, createRemoteJWKS } from '@ddisa/core'

// Generate ES256 key pair
const { publicKey, privateKey } = await generateKeyPair()

// Sign and verify JWTs
const token = await signJWT({ sub: 'alice@example.com', iss: 'https://idp.example.com' }, privateKey)
const { payload } = await verifyJWT(token, publicKey)
```

### PKCE

```typescript
import { generateCodeVerifier, generateCodeChallenge, generateState, generateNonce } from '@ddisa/core'

const verifier = generateCodeVerifier()
const challenge = await generateCodeChallenge(verifier)
const state = generateState()
const nonce = generateNonce()
```

### Validation

```typescript
import { validateAssertion, validateSPManifest, validateGrant, computeCmdHash } from '@ddisa/core'

const result = validateAssertion(claims, { expectedIss: '...', expectedAud: '...', maxTTL: 300 })
const hash = await computeCmdHash('rm -rf /tmp/test')
```

### Types

All protocol types are exported: `DDISARecord`, `PolicyMode`, `SPManifest`, `DDISAAssertionClaims`, `ClawGateGrant`, `ClawGateGrantRequest`, `ClawGateAuthZClaims`, `GrantType`, `GrantStatus`, and more.

## License

MIT
