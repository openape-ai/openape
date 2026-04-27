# @openape/proxy

## 0.2.15

### Patch Changes

- [`6c13d24`](https://github.com/openape-ai/openape/commit/6c13d244354ac8ce5639923c806922d4c1b46b35) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - proxy + apes: Node-runnable build for `@openape/proxy`, depended on by `@openape/apes`

  `@openape/proxy` is now distributed as a Node-runnable bundle (`dist/index.js` with
  `#!/usr/bin/env node` shebang, exec bit set, target node22) instead of a Bun-only
  TypeScript source. The package's `bin` entry now points at `dist/index.js`, the
  package ships `dist/`, `config.example.toml`, and `README.md`.

  `@openape/apes` adds `@openape/proxy` as a `workspace:*` dependency. This is
  foundation work for the upcoming `apes proxy -- <cmd>` subcommand: a global
  `npm i -g @openape/apes` install will from now on also install the proxy
  binary, and `apes` can locate it via
  `require.resolve('@openape/proxy/package.json')` plus the `bin` field — no
  `bun` runtime required on the user's machine.

  No CLI behavior change today. `apes proxy --` lands in the next milestone.

- [`7b2a7a4`](https://github.com/openape-ai/openape/commit/7b2a7a4aa27173fa15e0fdde6c957059a50bca65) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - apes: new `apes proxy -- <cmd>` subcommand routes commands through the egress proxy

  ```bash
  apes proxy -- curl https://api.github.com/zen
  apes proxy -- gh repo list
  apes proxy -- bash -c 'curl https://...'
  ```

  The subcommand mirrors the orchestration shape of `apes run --root → escapes`:
  it is a thin wrapper that owns the _lifecycle_, not the policy. The actual
  allow/deny/grant-required rules live in `@openape/proxy` (a separate runnable),
  which is now spawned as a child process per invocation.

  Two lifecycle modes:

  1. **Ephemeral (default):** `apes proxy --` spawns a new `openape-proxy` child
     bound to a random free port on `127.0.0.1`, runs the wrapped command with
     `HTTPS_PROXY` / `HTTP_PROXY` pointing at it, kills the proxy on wrapped-
     command exit. Lifecycle = command lifecycle, like `time` or `op run`.
  2. **Reuse:** if `OPENAPE_PROXY_URL` is set in the environment, `apes proxy --`
     skips the spawn and points `HTTPS_PROXY` at the existing URL. This is the
     path that ape-shell will take in M1b: the user can run `openape-proxy &`
     themselves, `export OPENAPE_PROXY_URL=...`, and every subsequent
     `apes proxy --` reuses that long-lived daemon.

  Default config for the ephemeral spawn is permissive (`default_action = "allow"`)
  plus a small deny-list for cloud-metadata endpoints (AWS/GCP/Azure
  `169.254.169.254`, `metadata.google.internal`, `*.internal`). Per-user TOML
  overlay + harder defaults land in M2.

  `@openape/proxy` patch: the listen-callback now reads `server.address()` so
  the `Listening on http://...:<port>` line shows the actual bound port even
  when configured with `listen = "127.0.0.1:0"`. Used by `apes proxy --` to
  discover its child's port.

## 0.2.14

### Patch Changes

- Updated dependencies [[`d7f78fa`](https://github.com/openape-ai/openape/commit/d7f78fa68478f295202351e15bfada8ce849c4db)]:
  - @openape/core@0.13.2
  - @openape/grants@0.11.2

## 0.2.13

### Patch Changes

- Updated dependencies [[`ed1ad3f`](https://github.com/openape-ai/openape/commit/ed1ad3f6cd7d8ed2c9309cabda503d3ecf6453ff)]:
  - @openape/core@0.13.1
  - @openape/grants@0.11.1

## 0.2.12

### Patch Changes

- Updated dependencies [[`d1c8f5a`](https://github.com/openape-ai/openape/commit/d1c8f5a711b088ac160c92d67a532f6f4d77d437)]:
  - @openape/grants@0.11.0

## 0.2.11

### Patch Changes

- Updated dependencies [[`d8e1516`](https://github.com/openape-ai/openape/commit/d8e15161d7edda67139633ec18c959a2cc8a57bd)]:
  - @openape/grants@0.10.0

## 0.2.10

### Patch Changes

- Updated dependencies [[`03edf70`](https://github.com/openape-ai/openape/commit/03edf70c9aa73a362cc3376d3a8f8e041620d054)]:
  - @openape/core@0.13.0
  - @openape/grants@0.9.0

## 0.2.9

### Patch Changes

- Updated dependencies [[`6c0cbad`](https://github.com/openape-ai/openape/commit/6c0cbada5165dc4e45381ffdaca847cd9dfc1d02)]:
  - @openape/grants@0.8.0

## 0.2.8

### Patch Changes

- Fix ReDoS-vulnerable regex in proxy auth header parsing. Fix lint violations across packages. Update import paths for CLI permissions moved to @openape/grants.

- Updated dependencies []:
  - @openape/core@0.12.0
  - @openape/grants@0.7.0

## 0.2.7

### Patch Changes

- Updated dependencies []:
  - @openape/core@0.11.0
  - @openape/grants@0.6.0

## 0.2.6

### Patch Changes

- Updated dependencies [[`da8a5ac`](https://github.com/openape-ai/openape/commit/da8a5acf82542810ecddf4ad7a9ac8b7b1cfd287)]:
  - @openape/core@0.10.0
  - @openape/grants@0.5.3

## 0.2.5

### Patch Changes

- Updated dependencies [[`bd1eb0d`](https://github.com/openape-ai/openape/commit/bd1eb0d83f700f1c289d21a545d3d62ced7f44d6)]:
  - @openape/core@0.8.0
  - @openape/grants@0.5.2

## 0.2.4

### Patch Changes

- Relicense from AGPL-3.0-or-later to MIT, rename OpenAPE to OpenApe

- Updated dependencies []:
  - @openape/grants@0.5.1
  - @openape/core@0.7.1

## 0.2.3

### Patch Changes

- Updated dependencies []:
  - @openape/core@0.7.0
  - @openape/grants@0.5.0

## 0.2.2

### Patch Changes

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

- Updated dependencies [[`3f0a62f`](https://github.com/openape-ai/openape/commit/3f0a62f25b07623d13f4e450683133415807358f)]:
  - @openape/core@0.6.0
  - @openape/grants@0.4.0
