# @openape/protocol-conformance

`@openape/protocol-conformance` validates OpenApe protocol artifacts against the JSON schemas in `packages/protocol-conformance/schemas`.

## What it contains

This package contains:

- JSON schemas for protocol documents such as grants, discovery extensions, manifests, delegations, and error payloads
- test helpers that load those schemas into Ajv 2020-12
- conformance tests that validate real objects produced by `@openape/core`, `@openape/grants`, and `@openape/server`

The package does not currently expose a public runtime entrypoint. The source of truth is the schema set plus the test harness in `test/harness.ts`.

## Validate a schema in tests

Use `getValidator()` from `test/harness.ts` to load one of the preloaded schemas and validate a value against it.

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

`validate(data)` returns:

- `valid`: `true` when the value matches the schema
- `errors`: an empty string on success, or a formatted JSON string of Ajv errors on failure

## Available validator helper

### `getValidator(schemaFilename: string)`

Returns a validator wrapper for one of the schemas preloaded by the test harness.

Accepted schema filenames are:

- `authz-jwt-claims.json`
- `client-metadata.json`
- `ddisa-record.json`
- `delegation.json`
- `error.json`
- `grant-request.json`
- `grant.json`
- `openid-configuration-extensions.json`
- `sp-scope-catalog.json`

If the filename is not preloaded, `getValidator()` throws `Schema not pre-loaded: <filename>`.
If Ajv cannot resolve the schema by `$id`, it throws `Validator not found for schema id: <schemaId>`.

## Run the package checks

```bash
pnpm --filter @openape/protocol-conformance lint
pnpm --filter @openape/protocol-conformance typecheck
pnpm --filter @openape/protocol-conformance test
```

## Sync schemas

```bash
pnpm --filter @openape/protocol-conformance sync-schemas
```

This runs `scripts/sync-protocol-schemas.mjs` from the repository root.
