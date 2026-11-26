---
'@openape/pods': patch
---

Re-authenticate a running Pod's identity at the IdP every minute and cancel the
run as soon as its identity, key or owner is refused, instead of only at the
run's next service call. A temporarily unreachable IdP skips that check.
