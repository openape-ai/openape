---
'@openape/nuxt-auth-idp': minor
---

Close the passkey-graft account-takeover path (closes #291).

The unauthenticated `POST /api/webauthn/register/verify` flow used to APPEND a credential to a user that already had passkeys. Anyone with read-access to the user's mailbox (transient compromise, leaked dump, recycled provider, kiosk session) could therefore mail themselves a registration token, register their own passkey, and gain permanent first-class control of the account — surviving every password-reset / recovery flow because the attacker's passkey IS itself a first-class credential.

The verify endpoint now refuses to register a credential when the user already has at least one passkey and the request comes through the unauthenticated mail-token path. Legitimate flows continue to work:

- **First-time enrolment** (no user yet, or user but zero credentials): unchanged — the mail token is the only trust anchor possible when no credential exists.
- **Add a device while authenticated**: was already a separate endpoint (`POST /api/webauthn/credentials/add/verify`) that requires a fresh assertion against an existing credential.
- **Lost-everything recovery**: tracked in #297 — 72h email-hold flow with single-token semantics + push-broadcast, separate code path.

Four regression tests pin the gate.
