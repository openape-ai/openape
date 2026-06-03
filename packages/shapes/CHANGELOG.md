# @openape/shapes

## 0.7.1

### Patch Changes

- Updated dependencies [3e3dfea]
  - @openape/core@0.18.0
  - @openape/grants@0.12.1

## 0.7.0

### Minor Changes

- a0d8506: Extract the pure Shapes library core (parser, adapters, registry, installer, toml, capabilities, request-builders, shell-parser, types, audit, http, config) from `@openape/apes` into a new `@openape/shapes` package. Grant-orchestration and CLI glue stay in apes and consume the package. No behaviour change.
