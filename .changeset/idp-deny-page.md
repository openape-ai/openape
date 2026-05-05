---
'@openape/nuxt-auth-idp': minor
---

Friendly deny page for the human authorize flow. Previously a `decision === 'deny'` (from `mode=deny` or an unapproved `mode=allowlist-admin` SP) silently bounced the user back to the SP with a URL-param error they wouldn't read. Now the IdP shows `/denied` with reason-specific copy ("Der Domain-Admin hat <SP> noch nicht freigegeben", "Bitte den Admin, …") and a "back to SP" button that completes the OAuth-spec redirect (RFC 6749 §4.1.2.1). Bearer flows skip the page — agents have no UI so they get the spec-direct redirect as before.

New routes: `/denied` (page), `GET /api/authorize/denied`, `POST /api/authorize/denied`.
