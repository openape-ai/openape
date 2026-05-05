---
'@openape/nuxt-auth-idp': patch
---

Register six previously-unregistered server route handlers so consuming apps actually expose them:

- `GET /api/authorize/consent` and `POST /api/authorize/consent` (used by the `/consent` page from the `allowlist-user` flow, #301)
- `GET /api/account/consents` and `DELETE /api/account/consents/:clientId` (self-service consent management)
- `GET /api/admin/delegations` and `DELETE /api/admin/delegations/:id` (admin)

The handler files existed under `runtime/server/api/` but were never wired up in the module's `addServerHandler` calls, so requests hit a 404 in production.
