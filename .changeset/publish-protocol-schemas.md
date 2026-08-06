---
"@openape/protocol-conformance": minor
---

Publish the package so the protocol JSON Schemas are installable. `schemas/` is
the only thing that ships, exposed as `@openape/protocol-conformance/schemas/*`,
and `@openape/core` / `@openape/grants` moved to devDependencies — validating a
payload must not pull in the implementation. The Vitest suite still keeps the
schemas honest inside the repo.
