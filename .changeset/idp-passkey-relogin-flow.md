---
"@openape/nuxt-auth-idp": patch
---

idp: existing users can self-serve passkey re-registration after passkey loss

Previously `POST /api/register` returned a silent `{ok:true}` for any email
that already had a user record, while only sending the registration mail for
unknown emails. The intent was email-enumeration protection. The side effect
was that users who lost their passkey (lost device, ditched browser profile,
or — in our case — got migrated to a new RP-domain so their existing passkey
no longer matched) were locked out without any self-service path.

`POST /api/register` now always issues a registration token and sends the
mail, regardless of whether the user record exists. The verify endpoint
(`webauthn/register/verify.post.ts`) already handled the existing-user case
idempotently: it skips user creation and just appends the new credential.

Email-enumeration protection is preserved at the response/timing layer —
both unknown and known emails get the same `{ok:true}` response and the
same mail-send latency. The mail content is identical for both, so an
attacker who already controls the victim's mailbox can't differentiate
"known" vs "unknown" any more easily than via any normal mail-based
recovery flow on any other product.

Frontend changes:
- `useWebAuthn` composable now reads `error.data.title` (h3 ProblemDetails)
  in addition to `statusMessage`, so users see "No passkeys found for this
  email" instead of the raw FetchError string `[POST] "...": 404`.
- Login page detects the "no passkeys" case and shows an actionable CTA
  pointing at `/register-email?email=…` to trigger the recovery flow.
- `/register-email` pre-fills from the `?email=` query param so users
  don't retype their address.
