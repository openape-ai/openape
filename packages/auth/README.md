# @openape/auth

DDISA protocol implementation for both Identity Providers (IdP) and Service Providers (SP). Framework-agnostic — provides the authorization flow logic, token exchange, WebAuthn integration, and store interfaces without binding to any HTTP framework.

> **Note:** The DDISA protocol uses an authorize/token/callback pattern but is its own protocol — not a standard OAuth or federation profile. Tokens are called *assertions*, not ID tokens.

## Installation

```bash
npm install @openape/auth
```

Peer dependency: `@openape/core`

## IdP API

Functions for building an Identity Provider.

### Authorization

- `validateAuthorizeRequest(params)` — Validate incoming authorization request parameters
- `evaluatePolicy(params)` — Evaluate IdP policy for a given SP and user

### Token Exchange

- `handleTokenExchange(params, stores)` — Exchange authorization code for a signed assertion
- `issueAssertion(params)` — Issue a signed DDISA assertion JWT

### JWKS

- `generateJWKS(keyStore)` — Generate a JWKS response from stored keys
- `serveJWKS(handler, keyStore)` — Serve the `/.well-known/jwks.json` endpoint

### WebAuthn

Registration and authentication using passkeys.

- `createRegistrationOptions(rpConfig, credential, challenge)` — Generate WebAuthn registration options
- `createAuthenticationOptions(challenge)` — Generate WebAuthn authentication options
- `verifyRegistration(response, challenge, credential)` — Verify registration response, returns `WebAuthnCredential`
- `verifyAuthentication(response, challenge, credential)` — Verify authentication response
- `uint8ArrayToBase64URL(array)` / `base64URLToUint8Array(str)` — Encoding helpers

#### WebAuthn Config

```typescript
interface RPConfig {
  name: string    // Relying party display name
  id: string      // Relying party ID (domain)
  origin: string  // Expected origin
}
```

## SP API

Functions for building a Service Provider.

- `discoverIdP(domain)` — Discover IdP configuration via DNS
- `createAuthorizationURL(options)` — Build authorization URL with PKCE
- `handleCallback(params, options)` — Handle callback, exchange code for assertion
- `createSPManifest(config)` — Create an SP manifest object
- `serveSPManifest(handler, manifest)` — Serve the `/.well-known/sp-manifest.json` endpoint

## Store Interfaces

The IdP requires several stores for state management. In-memory implementations are included for development.

### CodeStore

```typescript
interface CodeStore {
  save(entry: CodeEntry): Promise<void>
  find(code: string): Promise<CodeEntry | null>
  delete(code: string): Promise<void>
}
```

### KeyStore

```typescript
interface KeyStore {
  getSigningKey(): Promise<KeyEntry>
  getAllPublicKeys(): Promise<KeyEntry[]>
}
```

### ConsentStore

```typescript
interface ConsentStore {
  hasConsent(userId: string, clientId: string): Promise<boolean>
  save(entry: ConsentEntry): Promise<void>
}
```

### ChallengeStore

```typescript
interface ChallengeStore {
  save(challenge: WebAuthnChallenge): Promise<void>
  find(challengeId: string): Promise<WebAuthnChallenge | null>
  delete(challengeId: string): Promise<void>
}
```

### CredentialStore

```typescript
interface CredentialStore {
  save(credential: WebAuthnCredential): Promise<void>
  find(id: string): Promise<WebAuthnCredential | null>
  list(userId: string): Promise<WebAuthnCredential[]>
  delete(id: string): Promise<void>
}
```

### RegistrationUrlStore

```typescript
interface RegistrationUrlStore {
  save(entry: RegistrationUrl): Promise<void>
  find(token: string): Promise<RegistrationUrl | null>
  delete(token: string): Promise<void>
  list(userId: string): Promise<RegistrationUrl[]>
}
```

In-memory implementations: `InMemoryCodeStore`, `InMemoryConsentStore`, `InMemoryKeyStore`.

## Example: SP Login Flow

```typescript
import { discoverIdP, createAuthorizationURL, handleCallback } from '@openape/auth'
import { resolveIdP } from '@openape/core'

// 1. Discover the user's IdP via DNS
const idpUrl = await resolveIdP('user@example.com'.split('@')[1])

// 2. Build the authorization URL with PKCE
const { authorizationUrl, codeVerifier, state, nonce } = await createAuthorizationURL({
  idpUrl,
  clientId: 'sp.example.com',
  redirectUri: 'https://sp.example.com/callback',
})
// → Redirect user to authorizationUrl

// 3. Handle the callback after user authenticates
const { user } = await handleCallback(
  { code, state },
  { codeVerifier, nonce, idpUrl, clientId: 'sp.example.com', redirectUri: 'https://sp.example.com/callback' }
)
// user.sub = 'user@example.com', user.act = 'human'
```

## License

[MIT](./LICENSE)
