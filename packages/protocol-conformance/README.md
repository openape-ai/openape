# @openape/protocol-conformance

`@openape/protocol-conformance` validates representative OpenApe protocol objects against the JSON schemas in `schemas/`.

## What this package contains

This package contains:

- protocol schemas in `schemas/`
- an Ajv-based validator loader in `test/harness.ts`
- Vitest suites in `test/*.test.ts` that exercise real objects produced by `@openape/core`, `@openape/grants`, and `@openape/server`

The package does not publish a runtime API from `src/`. Its usable entry points are the schemas and the test helper used by the conformance tests.

## Public export

### `getValidator(schemaFilename: string)`

`test/harness.ts` exports `getValidator(schemaFilename)`. It loads one of the preloaded schemas, resolves cross-schema `$ref` links through Ajv 2020-12, and returns an object with a `validate(data)` function.

Supported schema filenames:

- `authz-jwt-claims.json`
- `client-metadata.json`
- `ddisa-record.json`
- `delegation.json`
- `error.json`
- `grant-request.json`
- `grant.json`
- `openid-configuration-extensions.json`
- `sp-scope-catalog.json`

If `schemaFilename` is not preloaded, `getValidator()` throws `Schema not pre-loaded: <filename>`.

## Returned validator

### `validate(data: unknown)`

`validate(data)` returns:

- `valid`: `true` when `data` matches the schema
- `errors`: `''` on success, or a formatted JSON string of Ajv validation errors on failure

## Example

```ts
import { getValidator } from './test/harness.js'

const { validate } = getValidator('grant.json')

const result = validate({
  id: 'grant-123',
  status: 'approved',
  request: {
    requester: 'agent@example.com',
    target_host: 'macmini.local',
    audience: 'apes',
    grant_type: 'once',
  },
  created_at: 1710000000,
  decided_by: 'admin@example.com',
  decided_at: 1710000060,
})

console.log(result.valid)
console.log(result.errors)
```

## What the test suites validate

- `test/grant.test.ts` validates pending, approved, and standing grant objects against `grant.json`
- `test/authz-jwt.test.ts` validates issued authorization JWT claims against `authz-jwt-claims.json`
- `test/discovery.test.ts` validates OpenID discovery documents with DDISA and OpenApe extension fields against `openid-configuration-extensions.json`
- `test/manifest.test.ts` validates scope catalog payloads against `sp-scope-catalog.json` and checks `validateOpenApeManifest()` from `@openape/core`

## Run this package

```bash
pnpm --filter @openape/protocol-conformance lint
pnpm --filter @openape/protocol-conformance typecheck
pnpm --filter @openape/protocol-conformance test
```

## Refresh schemas

```bash
pnpm --filter @openape/protocol-conformance sync-schemas
```

This command runs `scripts/sync-protocol-schemas.mjs` from the repository root.
