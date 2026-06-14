# @openape/protocol-conformance

`@openape/protocol-conformance` keeps the protocol schemas in `packages/protocol-conformance/schemas` executable by validating representative protocol objects against them in Vitest.

## What this package contains

This package currently contains:

- JSON Schema files for OpenAPE and DDISA protocol documents
- a shared test harness that loads those schemas into Ajv 2020-12
- Vitest suites that validate real objects and token claims produced by `@openape/core`, `@openape/grants`, and `@openape/server`

It does not currently export a runtime API from `src/index.ts`. The package is exercised through its test suite.

## Schemas

The `schemas/` directory contains validators for these document shapes:

- `authz-jwt-claims.json` — authorization JWT claims
- `client-metadata.json` — client metadata
- `ddisa-record.json` — DDISA records
- `delegation.json` — delegations
- `error.json` — error responses
- `grant-request.json` — grant requests
- `grant.json` — grants
- `openid-configuration-extensions.json` — OpenID discovery extensions used by OpenAPE
- `sp-scope-catalog.json` — service-provider scope catalogs

See [`schemas/README.md`](./schemas/README.md) for schema-specific notes.

## Run the checks

From the repository root:

```bash
pnpm --filter @openape/protocol-conformance test
pnpm --filter @openape/protocol-conformance typecheck
pnpm --filter @openape/protocol-conformance lint
```

## Test harness

The shared harness lives in [`test/harness.ts`](./test/harness.ts).

### `getValidator(schemaFilename)`

`getValidator` returns a validator wrapper for one preloaded schema file.

```ts
import { getValidator } from './test/harness.js'

const { validate } = getValidator('grant.json')
const result = validate(data)
```

The returned `validate(data)` method reports:

- `valid` — `true` when the object matches the schema
- `errors` — a formatted JSON string of Ajv errors when validation fails

## Test coverage

The package currently validates these concrete protocol shapes:

### Authorization JWT claims

[`test/authz-jwt.test.ts`](./test/authz-jwt.test.ts) issues authorization JWTs with `issueAuthzJWT()` and validates the decoded claims against `schemas/authz-jwt-claims.json`.

It covers:

- a basic approved one-time grant
- a delegation grant with `scopes`
- a delegation grant with a `delegate`

### Discovery document extensions

[`test/discovery.test.ts`](./test/discovery.test.ts) builds a discovery document in the same shape as the server discovery handler and validates it against `schemas/openid-configuration-extensions.json`.

It checks:

- required DDISA extension fields
- full-document schema validity
- a valid subset of `ddisa_auth_methods_supported`
- canonical `ddisa_auth_*` endpoint names

### Grant objects

[`test/grant.test.ts`](./test/grant.test.ts) creates and approves grants with `@openape/grants`, then validates the resulting objects against `schemas/grant.json`.

It covers:

- an approved command grant
- a pending grant
- an approved grant with `type: "standing"`

### Service-provider manifest and scope catalog

[`test/manifest.test.ts`](./test/manifest.test.ts) validates two related protocol shapes:

- an `openape.json` manifest accepted by `validateOpenApeManifest()` from `@openape/core`
- an array-based scope catalog validated against `schemas/sp-scope-catalog.json`

## Refresh mirrored schemas

To update the schema mirror from a sibling `protocol` checkout:

```bash
pnpm --filter @openape/protocol-conformance sync-schemas
```
