---
"@openape/apes": patch
---

Test-only: the IdP-backed suites now boot the real `examples/idp` app (via the
shared `openape-e2e/idp-fixture` helper) instead of the `@openape/server` fork,
which has been removed from the monorepo. No runtime change to the CLI.
