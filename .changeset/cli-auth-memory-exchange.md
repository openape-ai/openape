---
"@openape/cli-auth": minor
---

Add `requestSpToken`, the SP token exchange without the on-disk token cache and
with an optional caller-provided transport. `exchangeForSpToken` keeps its
persistence on top of it. The default exchange transport now refuses redirects,
so a 307/308 can never resend the subject token to another target.
