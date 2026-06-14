# @openape/protocol-conformance

`@openape/protocol-conformance` keeps a local copy of OpenApe protocol JSON schemas and validates representative runtime objects against them in tests.

## What this package contains

- `schemas/` — protocol JSON schemas mirrored from `openape-ai/protocol`
- `test/harness.ts` — an Ajv 2020-12 validator that preloads every schema so `$ref` resolution works across files
- `test/*.test.ts` — conformance tests that validate objects produced by the current OpenApe packages against the mirrored schemas

This package is private and does not publish a runtime API.

## Included schema files

The package currently validates these schema files:

- `authz-jwt-claims.json`
- `client-metadata.json`
- `ddisa-record.json`
- `delegation.json`
- `error.json`
- `grant-request.json`
- `grant.json`
- `openid-configuration-extensions.json`
- `sp-scope-catalog.json`

## What the tests cover

The tests document the wire formats the repository currently produces and accepts.

### `test/manifest.test.ts`

Validates:

- an `OpenApeManifest` object with `validateOpenApeManifest` from `@openape/core`
- an array-form scope catalog against `sp-scope-catalog.json`

### `test/discovery.test.ts`

Builds a discovery document in the same shape as the server discovery handler and validates it against `openid-configuration-extensions.json`.

The test covers:

- required DDISA extension fields such as `ddisa_version`
- supported DDISA auth methods
- canonical `ddisa_auth_*` endpoint names
- OpenApe grant and delegation extension fields

### `test/grant.test.ts`

Creates grants with `@openape/grants` and validates:

- an approved grant against `grant.json`
- a pending grant against `grant.json`
- a standing grant object against `grant.json`

### `test/authz-jwt.test.ts`

Issues authorization JWTs with `@openape/grants`, decodes their claims, and validates the claims against `authz-jwt-claims.json`.

The test covers:

- a basic approved once-grant token
- delegation token claims with `scopes`
- delegation token claims with `delegate`

## Run the checks

From the repo root:

```bash
pnpm --filter @openape/protocol-conformance lint
pnpm --filter @openape/protocol-conformance typecheck
pnpm --filter @openape/protocol-conformance test
```

## Refresh the mirrored schemas

Update the local schema mirror with:

```bash
pnpm --filter @openape/protocol-conformance sync-schemas
```

`schemas/README.md` remains the source of truth for the mirror policy and refresh command.
