# @openape/server

## 0.3.1

### Patch Changes

- Updated dependencies [[`cbcffc7`](https://github.com/openape-ai/openape/commit/cbcffc74d7fe08520c1a18f2d546181446c1cfca)]:
  - @openape/auth@0.7.0

## 0.3.0

### Minor Changes

- [#160](https://github.com/openape-ai/openape/pull/160) [`caf8d93`](https://github.com/openape-ai/openape/commit/caf8d93bd7df18b7789fca14cbe40f4242cf8e57) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - IdP-issued auth tokens now carry `aud='apes-cli'` consistently across every flow (PKCE / authorization-code, client-credentials, agent-challenge-response). Previously only the PKCE flow set an audience claim; SSH-key and challenge-response flows issued audience-less tokens, which made it impossible for downstream service providers to do scoped replay-protection on token-exchange endpoints.

  - `issueAuthToken` and `issueAgentToken` (in both `@openape/nuxt-auth-idp` and `@openape/server`) accept an optional `aud` parameter and default to `'apes-cli'`.
  - New `DEFAULT_CLI_AUDIENCE` constant exported for downstream consumers (`expectedAud`).
  - `verifyAuthToken` / `verifyAgentToken` accept an optional `expectedAud` parameter for audience-restricted verification. When omitted, audience is not checked (preserves backward compatibility with consumers that don't care).
  - Existing in-flight tokens (max 1h lifetime) are unaffected; new issuance immediately sets the audience.

  This is a precondition for the upcoming token-exchange endpoint on plans / tasks / secrets / seeds SPs that need to enforce `expectedAud='apes-cli'` to reject replays of id_tokens or delegation tokens against the exchange.

### Patch Changes

- Updated dependencies [[`d7f78fa`](https://github.com/openape-ai/openape/commit/d7f78fa68478f295202351e15bfada8ce849c4db)]:
  - @openape/core@0.13.2
  - @openape/auth@0.6.3
  - @openape/grants@0.11.2

## 0.2.5

### Patch Changes

- Updated dependencies [[`ed1ad3f`](https://github.com/openape-ai/openape/commit/ed1ad3f6cd7d8ed2c9309cabda503d3ecf6453ff)]:
  - @openape/core@0.13.1
  - @openape/auth@0.6.2
  - @openape/grants@0.11.1

## 0.2.4

### Patch Changes

- Updated dependencies [[`d1c8f5a`](https://github.com/openape-ai/openape/commit/d1c8f5a711b088ac160c92d67a532f6f4d77d437)]:
  - @openape/grants@0.11.0

## 0.2.3

### Patch Changes

- Updated dependencies [[`d8e1516`](https://github.com/openape-ai/openape/commit/d8e15161d7edda67139633ec18c959a2cc8a57bd)]:
  - @openape/grants@0.10.0

## 0.2.2

### Patch Changes

- Updated dependencies [[`03edf70`](https://github.com/openape-ai/openape/commit/03edf70c9aa73a362cc3376d3a8f8e041620d054)]:
  - @openape/core@0.13.0
  - @openape/grants@0.9.0
  - @openape/auth@0.6.1

## 0.2.1

### Patch Changes

- Updated dependencies [[`6c0cbad`](https://github.com/openape-ai/openape/commit/6c0cbada5165dc4e45381ffdaca847cd9dfc1d02)]:
  - @openape/grants@0.8.0

## 0.2.0

### Minor Changes

- Initial release. Programmatic DDISA IdP and SP server built on h3. `createIdPApp(config)` starts a full IdP with ed25519 challenge-response auth, OIDC authorize/token flow, grant lifecycle, admin SSH key management. `createSPApp(config)` starts a Service Provider with login, callback, and session management. All endpoints work with in-memory stores — ideal for testing and lightweight deployments.

### Patch Changes

- Updated dependencies []:
  - @openape/auth@0.6.0
  - @openape/core@0.12.0
  - @openape/grants@0.7.0
