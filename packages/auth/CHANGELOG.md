# Changelog

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
