---
'@openape/nuxt-auth-idp': patch
'@openape/auth': patch
'@openape/server': patch
---

Security: deactivating a user now also stops EXISTING sessions and refresh
tokens, not only future logins (#1144 follow-up). `/authorize` re-checks
`user.isActive` on every access for live browser sessions, bearer tokens and
delegation delegators (`403 User is inactive`). The refresh flow
(`grant_type=refresh_token`) refuses deactivated users with 403 AND revokes
the whole refresh-token family, so the rotated successor token dies with it —
`handleRefreshGrant` gained an optional `isUserActive` resolver and throws the
new `InactiveUserError`. Account recovery (`/api/recovery/options` and
`/api/recovery/verify`) refuses deactivated accounts with 403; the cancel
endpoint deliberately stays open (active-owner veto, can only kill a pending
recovery). Access tokens remain stateless JWTs and stay valid until expiry
(≤5 min for SP assertions, 1h for agent tokens).
