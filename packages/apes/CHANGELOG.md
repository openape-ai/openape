# @openape/apes

## 0.5.0

### Minor Changes

- Add `init`, `enroll`, and `dns-check` commands for 3-minute onboarding

  - `apes init --sp/--idp`: scaffold SP or IdP projects from GitHub templates via giget
  - `apes enroll`: agent enrollment with browser handoff and Ed25519 challenge polling
  - `apes dns-check <domain>`: validate DDISA DNS TXT records and verify IdP discovery

## 0.4.0

### Minor Changes

- feat: incremental capability grants — extend existing grants with new requests

### Patch Changes

- Updated dependencies []:
  - @openape/core@0.11.0
  - @openape/grants@0.6.0
  - @openape/shapes@0.6.0

## 0.3.0

### Minor Changes

- [#14](https://github.com/openape-ai/openape/pull/14) [`da8a5ac`](https://github.com/openape-ai/openape/commit/da8a5acf82542810ecddf4ad7a9ac8b7b1cfd287) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Support wildcard resource matching for capability grants. A shorter granted resource chain now covers longer required chains (prefix matching), and `apes run` checks for existing capability grants before creating new exact-command grants.

### Patch Changes

- [#17](https://github.com/openape-ai/openape/pull/17) [`d03abbd`](https://github.com/openape-ai/openape/commit/d03abbd1e5dc3121e2e84a2434d2e13687413c10) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Remove deprecated `@openape/grapes` package. All CLIs now use `~/.config/apes/` exclusively — no grapes fallback. Update error messages and docs to reference `apes` CLI.

- Updated dependencies [[`d03abbd`](https://github.com/openape-ai/openape/commit/d03abbd1e5dc3121e2e84a2434d2e13687413c10), [`da8a5ac`](https://github.com/openape-ai/openape/commit/da8a5acf82542810ecddf4ad7a9ac8b7b1cfd287)]:
  - @openape/shapes@0.5.0
  - @openape/core@0.10.0
  - @openape/grants@0.5.3

## 0.2.1

### Patch Changes

- [`d7b9020`](https://github.com/openape-ai/openape/commit/d7b902065e119e7ae7c60e4d13ade2a9d654a0c1) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - fix: support short options (-name) and combined flags (-rl) in shapes parser

- Updated dependencies [[`d7b9020`](https://github.com/openape-ai/openape/commit/d7b902065e119e7ae7c60e4d13ade2a9d654a0c1)]:
  - @openape/shapes@0.4.1

## 0.2.0

### Minor Changes

- [`c195c81`](https://github.com/openape-ai/openape/commit/c195c8107d6b7723bbcd190cfa50d21acadbb3fc) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - feat: add @openape/apes unified CLI + MCP server

  New package `@openape/apes` consolidates grapes and shapes into a single CLI with MCP server mode for AI agents. Shapes gains additional library exports for grant lifecycle and installer functions. Bundled adapters removed in favor of registry-based installation.

### Patch Changes

- Updated dependencies [[`c195c81`](https://github.com/openape-ai/openape/commit/c195c8107d6b7723bbcd190cfa50d21acadbb3fc)]:
  - @openape/shapes@0.4.0
