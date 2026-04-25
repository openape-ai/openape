---
'@openape/nuxt-auth-idp': minor
'@openape/server': minor
---

IdP-issued auth tokens now carry `aud='apes-cli'` consistently across every flow (PKCE / authorization-code, client-credentials, agent-challenge-response). Previously only the PKCE flow set an audience claim; SSH-key and challenge-response flows issued audience-less tokens, which made it impossible for downstream service providers to do scoped replay-protection on token-exchange endpoints.

- `issueAuthToken` and `issueAgentToken` (in both `@openape/nuxt-auth-idp` and `@openape/server`) accept an optional `aud` parameter and default to `'apes-cli'`.
- New `DEFAULT_CLI_AUDIENCE` constant exported for downstream consumers (`expectedAud`).
- `verifyAuthToken` / `verifyAgentToken` accept an optional `expectedAud` parameter for audience-restricted verification. When omitted, audience is not checked (preserves backward compatibility with consumers that don't care).
- Existing in-flight tokens (max 1h lifetime) are unaffected; new issuance immediately sets the audience.

This is a precondition for the upcoming token-exchange endpoint on plans / tasks / secrets / seeds SPs that need to enforce `expectedAud='apes-cli'` to reject replays of id_tokens or delegation tokens against the exchange.
