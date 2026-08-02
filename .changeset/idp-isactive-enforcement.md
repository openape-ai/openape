---
'@openape/nuxt-auth-idp': patch
'@openape/server': patch
---

Security: enforce `user.isActive` on every IdP login path. A deactivated user
with SSH keys on file could still obtain challenges via `/api/auth/challenge`
(fallthrough to the direct SSH-key branch) and — in the Nuxt module — mint
tokens via `/api/auth/authenticate`, establish browser sessions via
`/api/session/login`, and log in via the WebAuthn routes. All of these now
refuse deactivated users with `403 User is inactive` (the legacy
`/api/agent/*` aliases keep their `404 User not found or inactive` shape).
The canonical `@openape/server` challenge handler no longer issues challenges
to deactivated users either.
