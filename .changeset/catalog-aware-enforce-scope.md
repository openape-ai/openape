---
'@openape/nuxt-auth-sp': minor
---

Catalog-aware scope enforcement in `requireCaller`: delegated tokens holding exact catalog scopes (e.g. `troop:cockpit-serve`) now pass when the SP manifest's catalog entry (`openapeSp.manifest.scopes[].grants`) covers the request's method + path (`:param`/`[param]` segments match one path segment, method case-insensitive). The `<prefix>:read|write` method convention remains the unchanged fallback for SPs without a catalog or scopes without a catalog entry. 403 responses now name the held scopes and what would be required. (#1033)
