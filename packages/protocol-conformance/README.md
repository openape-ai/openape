# @openape/protocol-conformance

`@openape/protocol-conformance` keeps the protocol schemas in `packages/protocol-conformance/schemas` executable by validating representative protocol objects against them in Vitest.

## What this package contains

This package currently contains:

- JSON Schema files for OpenAPE and DDISA protocol documents
- a shared test harness that loads those schemas into Ajv 2020-12
- Vitest suites that validate real objects and token claims produced by `@openape/core`, `@openape/grants`, and `@openape/server`
- a schema sync script exposed as `pnpm --filter @openape/protocol-conformance sync-schemas`

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

See [`schemas/README.md`](./schemas/README.md) for schema-specific notes and sync workflow.

## Test harness

The shared harness lives in [`test/harness.ts`](./test/harness.ts).

### `getValidator(schemaFilename)`

`getValidator` returns a validator wrapper for one preloaded schema file.

```ts
const { validate } = getValidator('grant.json')
const result = validate(data)
```

The returned `validate(data)` method reports:

- `valid` — `true` when the object matches the schema
- `errors` — a formatted JSON string of Ajv errors when validation fails

The harness preloads all package schemas so cross-schema `$ref` values resolve before validation runs.

## Test coverage

The package currently validates these concrete protocol shapes:

- [`test/manifest.test.ts`](./test/manifest.test.ts) checks OpenAPE manifest and scope catalog shapes
- [`test/discovery.test.ts`](./test/discovery.test.ts) checks the OpenID discovery document extensions emitted by the server
- [`test/grant.test.ts`](./test/grant.test.ts) checks pending, approved, and standing grant objects
- [`test/authz-jwt.test.ts`](./test/authz-jwt.test.ts) checks JWT claims emitted for command grants and delegation grants

## Usage example

Use the harness from a Vitest test to validate a protocol artifact against one of the bundled schemas:

```ts
import { describe, expect, it } from 'vitest'
import { getValidator } from './test/harness.js'

const { validate } = getValidator('grant.json')

describe('grant schema', () => {
  it('accepts an approved grant object', () => {
    const grant = {
      id: 'grant_123',
      status: 'approved',
      decided_by: 'admin@example.com',
      created_at: 1,
      decided_at: 2,
      request: {
        requester: 'agent@example.com',
        target_host: 'macmini.local',
        audience: 'apes',
        grant_type: 'once',
      },
    }

    const result = validate(grant)
    expect(result.valid, result.errors).toBe(true)
  })
})
```

## Running the checks

Run the package tests:

```bash
pnpm --filter @openape/protocol-conformance test
```

Run type checking:

```bash
pnpm --filter @openape/protocol-conformance typecheck
```

Sync the schema files from the protocol source:

```bash
pnpm --filter @openape/protocol-conformance sync-schemas
```
