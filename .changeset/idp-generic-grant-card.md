---
"@openape/nuxt-auth-idp": minor
"@openape/grants": minor
---

One generic grant card replaces the Pod run special case. `GET /api/grants`
and `GET /api/grants/:id` attach `card`: the registry presentation of the
grant's operation, rendered only when the IdP's shapes table holds the adapter
with the grant's adapter digest and the grant's argv matches the same
operation with the same permission (values come from that argv), plus the
requester's registered name and owner. Values that are not selectors of the
permission (and not part of an exact command) are marked "as requested";
oversized values, control or format characters, malformed maps and requests
that miss `presentation.requires.target_host` fall back to the exact command.
The approval page, the batch view and the grants list always lead with the
binding line — the registry title or the exact command; the requester's
summary appears only in a labeled "Requester's statement" block. The card
switches between German and English. `PodRunGrant` and `podRunPresentation`
are removed; the pod-runtime registry adapter carries their texts.

`[operation.presentation] requires.target_host` (a template over always-bound
bindings) is accepted by the presentation parser.
