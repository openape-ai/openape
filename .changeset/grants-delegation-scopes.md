---
"@openape/core": minor
"@openape/nuxt-auth-idp": minor
---

Add the delegation scopes `grants:read` and `grants:request` (delegation.md §8).
A user can let one of their own agents read the user's grants and standing
grants and file pending grant requests for the user's agents, through a
delegation whose audience is the IdP issuer. Delegated requests always stay
pending and record the submitter in `request.submitted_by`. Every other IdP
endpoint now refuses delegated tokens; before, a delegated `apes-cli` token
minted from a wildcard delegation was taken as the delegator everywhere,
including approve.
