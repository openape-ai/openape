---
"@openape/nuxt-auth-idp": minor
---

One generic grant card replaces the Pod run special case. `GET /api/grants`
and `GET /api/grants/:id` attach `card`: the registry presentation of the
grant's operation, rendered only when the IdP's shapes table holds the adapter
with the grant's adapter digest and the grant's argv matches the same
operation with the same permission (values come from that argv), plus the
requester's registered name and owner. The approval page, the batch view and
the grants list always lead with the binding line — the registry title or the
exact command; the requester's summary appears only in a labeled
"Requester's statement" block. The card switches between German and English.
`PodRunGrant` and `podRunPresentation` are removed; the pod-runtime registry
adapter carries their texts.
