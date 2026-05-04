# Changelog

## 0.7.0

### Minor Changes

- [`cbcffc7`](https://github.com/openape-ai/openape/commit/cbcffc74d7fe08520c1a18f2d546181446c1cfca) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Fix refresh-token cross-audience forgery (closes #274).

  `handleRefreshGrant` accepted a user-supplied `client_id` and passed it straight into `issueAssertion({ aud: clientId })` without verifying it matched the client the token was originally issued to. A refresh token captured for SP-A could therefore be redeemed at the IdP token endpoint with `client_id=SP-B` to mint a fresh assertion with `aud=SP-B` — RFC 6749 §6 audience binding broken.

  The handler now compares the request's `client_id` against the `clientId` returned from `RefreshTokenStore.consume` and throws a new `RefreshClientMismatchError` (also exported from the package) on mismatch. The IdP's `/token` route already maps any error from `handleRefreshGrant` to `400 invalid_grant`, so no route changes were needed.

## 0.6.3

### Patch Changes

- Updated dependencies [[`d7f78fa`](https://github.com/openape-ai/openape/commit/d7f78fa68478f295202351e15bfada8ce849c4db)]:
  - @openape/core@0.13.2

## 0.6.2

### Patch Changes

- Updated dependencies [[`ed1ad3f`](https://github.com/openape-ai/openape/commit/ed1ad3f6cd7d8ed2c9309cabda503d3ecf6453ff)]:
  - @openape/core@0.13.1

## 0.6.1

### Patch Changes

- Updated dependencies [[`03edf70`](https://github.com/openape-ai/openape/commit/03edf70c9aa73a362cc3376d3a8f8e041620d054)]:
  - @openape/core@0.13.0

## 0.6.0

### Minor Changes

- Add unified User/SshKey/GrantChallengeStore interfaces and in-memory implementations. The User interface replaces the separate User + Agent model — an agent is a User with `owner` set. New exports: `User`, `UserStore`, `InMemoryUserStore`, `SshKey`, `SshKeyStore`, `InMemorySshKeyStore`, `GrantChallengeStore`, `InMemoryGrantChallengeStore`.

### Patch Changes

- Updated dependencies []:
  - @openape/core@0.12.0

## 0.5.7

### Patch Changes

- Updated dependencies []:
  - @openape/core@0.11.0

## 0.5.6

### Patch Changes

- Updated dependencies [[`da8a5ac`](https://github.com/openape-ai/openape/commit/da8a5acf82542810ecddf4ad7a9ac8b7b1cfd287)]:
  - @openape/core@0.10.0

## 0.5.5

### Patch Changes

- Updated dependencies [[`bd1eb0d`](https://github.com/openape-ai/openape/commit/bd1eb0d83f700f1c289d21a545d3d62ced7f44d6)]:
  - @openape/core@0.8.0

## 0.5.4

### Patch Changes

- Relicense from AGPL-3.0-or-later to MIT, rename OpenAPE to OpenApe

- Updated dependencies []:
  - @openape/core@0.7.1

## 0.5.3

### Patch Changes

- Updated dependencies []:
  - @openape/core@0.7.0

## 0.5.2

### Patch Changes

- Updated dependencies [[`3f0a62f`](https://github.com/openape-ai/openape/commit/3f0a62f25b07623d13f4e450683133415807358f)]:
  - @openape/core@0.6.0

## 0.5.1

### Patch Changes

- fix: correct @openape/core dependency (was ^0.4.0 with ES256, needs ^0.5.0 for EdDSA)
