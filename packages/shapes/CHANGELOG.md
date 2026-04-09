# @openape/shapes

## 0.6.2

### Patch Changes

- Updated dependencies [[`6c0cbad`](https://github.com/openape-ai/openape/commit/6c0cbada5165dc4e45381ffdaca847cd9dfc1d02)]:
  - @openape/grants@0.8.0

## 0.6.1

### Patch Changes

- Fix ReDoS-vulnerable regex in proxy auth header parsing. Fix lint violations across packages. Update import paths for CLI permissions moved to @openape/grants.

- Updated dependencies []:
  - @openape/core@0.12.0
  - @openape/grants@0.7.0

## 0.6.0

### Minor Changes

- feat: incremental capability grants — extend existing grants with new requests

### Patch Changes

- Updated dependencies []:
  - @openape/core@0.11.0
  - @openape/grants@0.6.0

## 0.5.0

### Minor Changes

- [#14](https://github.com/openape-ai/openape/pull/14) [`da8a5ac`](https://github.com/openape-ai/openape/commit/da8a5acf82542810ecddf4ad7a9ac8b7b1cfd287) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Support wildcard resource matching for capability grants. A shorter granted resource chain now covers longer required chains (prefix matching), and `apes run` checks for existing capability grants before creating new exact-command grants.

### Patch Changes

- [#17](https://github.com/openape-ai/openape/pull/17) [`d03abbd`](https://github.com/openape-ai/openape/commit/d03abbd1e5dc3121e2e84a2434d2e13687413c10) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Remove deprecated `@openape/grapes` package. All CLIs now use `~/.config/apes/` exclusively — no grapes fallback. Update error messages and docs to reference `apes` CLI.

- Updated dependencies [[`da8a5ac`](https://github.com/openape-ai/openape/commit/da8a5acf82542810ecddf4ad7a9ac8b7b1cfd287)]:
  - @openape/core@0.10.0
  - @openape/grants@0.5.3

## 0.4.1

### Patch Changes

- [`d7b9020`](https://github.com/openape-ai/openape/commit/d7b902065e119e7ae7c60e4d13ade2a9d654a0c1) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - fix: support short options (-name) and combined flags (-rl) in shapes parser

## 0.4.0

### Minor Changes

- [`c195c81`](https://github.com/openape-ai/openape/commit/c195c8107d6b7723bbcd190cfa50d21acadbb3fc) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - feat: add @openape/apes unified CLI + MCP server

  New package `@openape/apes` consolidates grapes and shapes into a single CLI with MCP server mode for AI agents. Shapes gains additional library exports for grant lifecycle and installer functions. Bundled adapters removed in favor of registry-based installation.

## 0.3.0

### Minor Changes

- [`df035ff`](https://github.com/openape-ai/openape/commit/df035ff990edadb9b26e677893e5a1322f4bdab3) Thanks [@patrick-hofmann](https://github.com/patrick-hofmann)! - Add --duration flag to grapes request and request-capability for timed grants. Fix shapes --help not showing adapter subcommand. Add --refresh flag to all shapes adapter subcommands to bypass registry cache. Document wildcard grant pattern and cache troubleshooting in skills.

## 0.1.1

### Patch Changes

- Updated dependencies [[`bd1eb0d`](https://github.com/openape-ai/openape/commit/bd1eb0d83f700f1c289d21a545d3d62ced7f44d6)]:
  - @openape/core@0.8.0
  - @openape/grants@0.5.2
