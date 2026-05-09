---
'@openape/nuxt-auth-idp': minor
---

Add RFC 8693 OAuth Token Exchange endpoint (`POST /api/oauth/token-exchange`). Lets a delegate (typically an agent like the local Nest) act on behalf of a delegator (typically the human owner) at IdP-level. Inputs: `subject_token` (delegator's access token), `actor_token` (delegate's access token), `grant_type=urn:ietf:params:oauth:grant-type:token-exchange`, optional `audience` and `delegation_grant_id`. Output: a fresh access token with `sub=delegator` and `act={sub:delegate}` so downstream verifiers can do owner-attribution from the token alone — no server-side heuristics. Looks up the delegation grant either by explicit id or by scanning the delegator's approved grants for one matching delegate + audience.
