---
'@openape/pods': patch
'@openape/nuxt-auth-idp': patch
---

Re-check a running Pod's identity at the IdP every minute and cancel the run as
soon as the IdP refuses its identity or key, or reports its owner as removed or
inactive, instead of only at the run's next service call. An unreachable or
failing IdP skips that check and never delays the identity file refresh. The
IdP's Pod identity status (`GET /api/pods/agents/:email`) now also answers
without a grant, reporting only identity, keys and owner.
