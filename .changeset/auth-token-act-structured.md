---
'@openape/nuxt-auth-idp': minor
---

`AuthTokenPayload.act` and `verifyAuthToken` now accept the structured `DelegationActClaim` shape (`{ sub: string }`) emitted by the IdP's `/api/oauth/token-exchange` endpoint, in addition to the existing `'human' | 'agent'` strings. Tokens minted via token-exchange carry both `sub` (the delegator) and `act.sub` (the delegate); downstream consumers can do owner-attribution from the token alone. The `delegation_grant` claim (the id of the delegation that authorised the exchange) is also surfaced for audit.

Existing direct-issuance tokens (act=`agent` | `human`) are unchanged; only the verifier was extended to widen the accepted shape. `verifyAgentToken` (the strict "caller must be an agent" path) keeps its narrow contract.

Plus: enroll.post.ts has expanded comments documenting the three owner-attribution paths (delegated token, direct agent, direct human) — the transitive-ownership lookup is preserved as a soft-deprecated fallback for Nest setups that haven't yet created a delegation grant; the path becomes a no-op for tokens minted via token-exchange (where `sub` is already the human owner).
