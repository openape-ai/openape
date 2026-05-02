---
"@openape/apes": minor
"@openape/nuxt-auth-idp": minor
---

apes/idp: `apes sessions list` and `apes sessions remove <id>` for self-service device management

You can now see and revoke your own refresh-token families across devices without admin privileges:

- `apes sessions list` — one row per `apes login` (one row per device), with familyId, clientId, createdAt, expiresAt
- `apes sessions remove <familyId>` — revokes that specific family. The device using it fails its next token refresh with `Token family revoked` and has to `apes login` again

Backed by two new IdP endpoints under `/api/me/sessions/…`:
- `GET /api/me/sessions` — lists the caller's families (filtered to `userId = sub` from the authenticated session/JWT)
- `DELETE /api/me/sessions/[familyId]` — ownership-checked: 404 if the family belongs to a different user, never 403, so users can't probe other users' familyIds

The pre-existing admin endpoints at `/api/admin/sessions` (cross-user, requires admin role) stay as-is.
