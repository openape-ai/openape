---
"@openape/cli-auth": minor
---

Add `requestSpToken`, the SP token exchange without the on-disk token cache and
with an optional caller-provided transport. `exchangeForSpToken` keeps its
behaviour and persistence on top of it.
