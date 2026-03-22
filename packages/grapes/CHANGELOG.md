# Changelog

## 0.6.0

### Minor Changes

- [`aec76f8`](https://github.com/openape-ai/openape/commit/aec76f8f888a029f60139ab5b16bfaacf432cd62) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - rename: apes → escapes

  CLI flag `--apes-path` renamed to `--escapes-path`. Audience check changed from `"apes"` to `"escapes"`. Use `grapes run escapes "command"` instead of `grapes run apes "command"`.

## 0.5.0

### Minor Changes

- [`68c244e`](https://github.com/openape-ai/openape/commit/68c244e87c09285ef1e3e74d5f824b24ddccf8da) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Add --run-as flag to grapes request and request-capability to send run_as in grant requests, making the target user visible in the IdP UI.

- [`df035ff`](https://github.com/openape-ai/openape/commit/df035ff990edadb9b26e677893e5a1322f4bdab3) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Add --duration flag to grapes request and request-capability for timed grants. Fix shapes --help not showing adapter subcommand. Add --refresh flag to all shapes adapter subcommands to bypass registry cache. Document wildcard grant pattern and cache troubleshooting in skills.

### Patch Changes

- Updated dependencies [[`df035ff`](https://github.com/openape-ai/openape/commit/df035ff990edadb9b26e677893e5a1322f4bdab3)]:
  - @openape/shapes@0.3.0

## 0.3.4

### Patch Changes

- Updated dependencies [[`bd1eb0d`](https://github.com/openape-ai/openape/commit/bd1eb0d83f700f1c289d21a545d3d62ced7f44d6)]:
  - @openape/core@0.8.0

## 0.3.3

### Patch Changes

- Relicense from AGPL-3.0-or-later to MIT, rename OpenAPE to OpenApe

- Updated dependencies []:
  - @openape/core@0.7.1

## 0.3.2

### Patch Changes

- Updated dependencies []:
  - @openape/core@0.7.0

## 0.3.1

### Patch Changes

- Token endpoint accepts both agent and session auth. grapes shows clean error messages by default (use --debug for stack traces).

## 0.3.0

### Minor Changes

- [#1](https://github.com/openape-ai/openape/pull/1) [`3f0a62f`](https://github.com/openape-ai/openape/commit/3f0a62f25b07623d13f4e450683133415807358f) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Align implementation with DDISA spec v1.0-draft

  **@openape/core:**

  - **BREAKING:** `OpenApeGrantRequest.target` → `target_host` (host/domain), `audience` now REQUIRED
  - `OpenApeAuthZClaims` gets `target_host` as REQUIRED claim
  - Fix error status codes: `invalid_audience`/`invalid_nonce` → 401, `grant_not_approved` → 400, `grant_already_used` → 410
  - Add missing error types: `policyDenied`, `invalidPkce`, `invalidState`

  **@openape/grants:**

  - **BREAKING:** `issueAuthzJWT` sets `aud` from `audience` (not `target`), adds `target_host` + `run_as` claims

  **@openape/nuxt-auth-idp:**

  - Grant creation validates `target_host` + `audience` (REQUIRED)
  - Fix `ddisa_version` from `'ddisa1'` to `'1.0'`
  - Fix `ddisa_auth_methods_supported` from `'passkey'` to `'webauthn'`
  - Grant/Delegation create now returns HTTP 201
  - Batch endpoint: `body.actions` → `body.operations`, response includes `success` boolean
  - Delegation validate returns `{ valid, delegation, scopes }` instead of ProblemDetails
  - **BREAKING:** `authzJWT` → `authz_jwt` in approve/token API responses (snake_case per OAuth2)
  - Delegation list supports `?role=delegator|delegate` query parameter

  **@openape/grapes:**

  - **BREAKING:** Replace `exec` command with audience-first `run` command
  - `request` command uses `--audience` + `--host` instead of `--for`
  - Remove `defaults.for` from config

  **@openape/proxy:**

  - Update `GrantsClient` to use `targetHost` + `audience` parameters

### Patch Changes

- Updated dependencies [[`3f0a62f`](https://github.com/openape-ai/openape/commit/3f0a62f25b07623d13f4e450683133415807358f)]:
  - @openape/core@0.6.0
