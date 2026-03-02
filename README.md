# @openape/core

Foundation layer for the OpenApe ecosystem. Provides shared types, cryptographic primitives, DNS resolution, and validation utilities used by all other packages.

## Installation

```bash
npm install @openape/core
```

## Modules

### Types

Core type definitions for the DDISA protocol and grant system.

- `DDISARecord` — Parsed DNS TXT record pointing to an IdP
- `SPManifest` — Service Provider metadata (id, name, redirect URIs, JWKS)
- `DDISAAssertionClaims` — Signed assertion payload (iss, sub, aud, act, nonce, ...)
- `AuthorizationRequest` — Authorization endpoint parameters
- `TokenExchangeRequest` — Token endpoint parameters
- `AuthFlowState` — Client-side state during authorization flow
- `OpenApeGrant` — Grant object with status, requester, target, permissions
- `OpenApeGrantRequest` — Grant creation request
- `OpenApeAuthZClaims` — Authorization JWT payload
- `GrantType` — `'once' | 'timed' | 'always'`
- `GrantStatus` — `'pending' | 'approved' | 'denied' | 'revoked' | 'expired' | 'used'`
- `PolicyMode` — `'open' | 'allowlist-admin' | 'allowlist-user' | 'deny'`
- `ActorType` — `'human' | 'agent'`
- `ResolverOptions` — DNS resolver configuration (cache TTL, DoH provider, mocks)

### Crypto

Cryptographic utilities for key management, JWTs, PKCE, and password hashing.

- `generateKeyPair()` — Generate an Ed25519 key pair
- `signJWT(payload, privateKey, options?)` — Sign a JWT
- `verifyJWT<T>(token, keyOrJWKS, options?)` — Verify and decode a JWT
- `createRemoteJWKS(jwksUri)` — Create a JWKS fetcher for remote key sets
- `exportPublicKeyJWK(publicKey, kid?)` — Export public key as JWK
- `importJWK(jwk)` — Import a JWK into a KeyLike
- `generateCodeVerifier(length?)` — Generate a PKCE code verifier
- `generateCodeChallenge(verifier)` — Compute S256 code challenge
- `generateState()` — Random state parameter
- `generateNonce()` — Random nonce
- `generateSalt()` — Random salt for password hashing
- `hashPassword(password)` — Hash a password (argon2-like)
- `verifyPassword(password, hash)` — Verify a password against a hash

### DNS

DDISA record resolution via DNS TXT lookups with DoH fallback and caching.

- `resolveDDISA(domain, options?)` — Resolve DDISA record for a domain
- `resolveIdP(domain, options?)` — Shortcut: resolve and return only the IdP URL
- `clearDNSCache()` — Clear the in-memory DNS cache
- `parseDDISARecord(raw)` — Parse a raw TXT record string
- `extractDomain(email)` — Extract domain from an email address
- `resolveTXTviaDoh(domain, provider?)` — Resolve TXT records via DNS-over-HTTPS
- `detectRuntime()` — Detect current JS runtime (`'node' | 'bun' | 'deno' | 'edge' | 'browser'`)

### Validation

Validate assertions, authorization JWTs, and SP manifests.

- `validateAssertion(token, jwks, options?)` — Validate a signed DDISA assertion
- `validateAuthzJWT(token, jwks, options?)` — Validate an authorization JWT
- `computeCmdHash(command)` — Compute command hash for grant verification
- `validateSPManifest(manifest)` — Validate an SP manifest object
- `fetchAndValidateSPManifest(uri)` — Fetch and validate a remote SP manifest

### Constants

- `ALGORITHM` — Signing algorithm (`EdDSA`)
- `MAX_ASSERTION_TTL` — Maximum assertion lifetime
- `WELL_KNOWN_JWKS`, `WELL_KNOWN_SP_MANIFEST` — Well-known paths
- `DNS_TXT_TYPE` — DNS record type for DDISA
- `DOH_PROVIDERS` — Built-in DNS-over-HTTPS provider URLs

## Usage

### DNS Resolution

```typescript
import { resolveDDISA, resolveIdP } from '@openape/core'

// Full DDISA record
const record = await resolveDDISA('example.com')
// { version: 'ddisa1', idp: 'https://id.example.com', mode: 'open', raw: '...' }

// Just the IdP URL
const idpUrl = await resolveIdP('example.com')
// 'https://id.example.com'
```

### JWT Signing & Verification

```typescript
import { generateKeyPair, signJWT, verifyJWT } from '@openape/core'

const { publicKey, privateKey } = await generateKeyPair()

const token = await signJWT(
  { sub: 'user@example.com', aud: 'sp.example.com' },
  privateKey,
  { expiresIn: '5m' }
)

const { payload } = await verifyJWT(token, publicKey)
```

### PKCE

```typescript
import { generateCodeVerifier, generateCodeChallenge } from '@openape/core'

const verifier = generateCodeVerifier()
const challenge = await generateCodeChallenge(verifier)
```

## License

[AGPL-3.0-or-later](./LICENSE)
