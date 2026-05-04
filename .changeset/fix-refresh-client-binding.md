---
'@openape/auth': minor
---

Fix refresh-token cross-audience forgery (closes #274).

`handleRefreshGrant` accepted a user-supplied `client_id` and passed it straight into `issueAssertion({ aud: clientId })` without verifying it matched the client the token was originally issued to. A refresh token captured for SP-A could therefore be redeemed at the IdP token endpoint with `client_id=SP-B` to mint a fresh assertion with `aud=SP-B` — RFC 6749 §6 audience binding broken.

The handler now compares the request's `client_id` against the `clientId` returned from `RefreshTokenStore.consume` and throws a new `RefreshClientMismatchError` (also exported from the package) on mismatch. The IdP's `/token` route already maps any error from `handleRefreshGrant` to `400 invalid_grant`, so no route changes were needed.
