---
'@openape/cli-auth': minor
'@openape/apes': minor
'@openape/nuxt-auth-idp': patch
---

Wire up delegation token-exchange end-to-end:

- **`@openape/cli-auth`** exports `exchangeWithDelegation()` — posts an actor token + (optional) delegation grant id to the IdP's `/api/oauth/token-exchange` and returns a delegated access token whose `sub` is the delegator.
- **`@openape/apes`** `registerAgentAtIdp()` now checks if the local caller is itself an agent. If yes, it lists the owner's approved grants, finds the first delegation grant for the `enroll-agent` audience, exchanges tokens, and presents the delegated access token as `Authorization: Bearer …` to `/api/enroll`. Falls back to the direct call (caller-as-requester) when no delegation is configured — the IdP's transitive-ownership lookup still covers that path until M3.
- **IdP token-exchange** (`@openape/nuxt-auth-idp`) accepts a `delegation_grant_id` without requiring a `subject_token`: when the grant id is provided, the delegator identity is derived from `grant.delegator` and `subject_token` becomes optional (it can still be supplied for belt-and-suspenders verification, in which case its sub must match the grant's delegator).

The `subject_token`-only path (RFC 8693 strict mode) and the new `delegation_grant_id`-only path coexist on the same endpoint.
