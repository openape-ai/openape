---
'@openape/nuxt-auth-sp': minor
---

Consolidate `/api/cli/exchange` into a single hardened implementation (sp-data-access §5): the module handler now enforces the SP's scope catalog (`openapeSp.manifest.scopes`, skipped for SPs without one), live-checks `delegation_grant` revocation at the IdP (fail-closed 502 when unreachable), rejects scope-less delegated tokens (protocol#6) and forbids scope widening — including past an empty `scope: []` bound. Scoped/delegated exchanges answer with `scope` and `delegate` provenance and mint short-TTL tokens carrying both claims; the first-party CLI path (no scope claim, no requested scopes) stays byte-identical.
