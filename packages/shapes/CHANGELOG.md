# @openape/shapes

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
