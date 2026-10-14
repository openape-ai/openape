---
"@openape/nuxt-auth-idp": minor
---

Let a `grants:read` delegate read its delegator's brokered grants (for example
of their Pod identities), and let a `grants:request` delegate file a pending
request for a brokered identity of the delegator: the IdP takes the binding
from that identity's newest grant over an active broker connection of the
delegator and validates the request like a brokered one. A brokered continuing
request that an approved grant of the same binding already covers now returns
that grant instead of asking again; single-use and batch requests still ask.
