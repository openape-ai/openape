---
'@openape/auth': patch
'@openape/nuxt-auth-idp': patch
---

Security hardening of the SP-metadata consent flow. SP-controlled fields fetched from `/.well-known/oauth-client-metadata` are rendered by the IdP's consent UI; without sanitization a malicious SP could ship `javascript:` URIs in `policy_uri` / `tos_uri` and turn the IdP origin into an XSS sandbox at click time.

- `@openape/auth`: `createClientMetadataResolver` now normalizes every fetched (and operator-supplied) metadata document. URL fields (`logo_uri`, `policy_uri`, `tos_uri`, `client_uri`, `jwks_uri`) must parse as `http(s):` — anything else (`javascript:`, `data:`, `vbscript:`, …) is silently dropped. Display strings are length-capped (200 chars for names, 2000 for URLs).
- `@openape/nuxt-auth-idp`: the reference consent page and account-connections list no longer forward or render `logo_uri`. SP-supplied images are an unsanitisable surface (browser image-parser CVEs, fingerprinting, brand-spoofing) — deployers who want logos must override the page with their own UI.
