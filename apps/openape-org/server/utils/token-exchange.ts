// Cross-SP token-exchange via id.openape.ai's RFC 8693 endpoint.
//
// The pattern: org has its own IdP-issued agent access token
// (`ORG_IDP_ACCESS_TOKEN` env, minted once via `apes enroll` on
// chatty during bootstrap). When Owner asks org to do something on
// troop (e.g. spawn an agent), org calls:
//
//   POST id.openape.ai/api/oauth/token-exchange
//        grant_type=urn:ietf:params:oauth:grant-type:token-exchange
//        actor_token=<ORG_IDP_ACCESS_TOKEN>
//        delegation_grant_id=<delegation grant owner created>
//        audience=apes-cli
//
// IdP verifies + returns a Bearer with sub=ownerEmail, act={sub:org}.
// org then calls troop with that Bearer; troop's requireOwner
// extracts sub=ownerEmail and treats the call as if Owner did it.

import { useRuntimeConfig } from 'nitropack/runtime'

const TOKEN_EXCHANGE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:token-exchange'

export interface ExchangedToken {
  access_token: string
  token_type: string
  expires_in: number
  issued_token_type: string
}

/**
 * Exchange the calling SP's own access token + a delegator's
 * delegation grant for a Bearer scoped to `audience` with sub set
 * to the delegator. Throws on any IdP error.
 */
export async function exchangeForOwnerBearer(opts: {
  delegationGrantId: string
  audience?: string
}): Promise<ExchangedToken> {
  const config = useRuntimeConfig()
  const idpUrl = (config.public as { idpUrl?: string }).idpUrl as string
  const actorToken = (config as { orgIdpAccessToken?: string }).orgIdpAccessToken
  if (!actorToken) {
    throw new Error('ORG_IDP_ACCESS_TOKEN is not set — org has not been enrolled as an agent at the IdP. Run scripts/enroll-org-as-agent.sh.')
  }

  const res = await $fetch<ExchangedToken>(`${idpUrl}/api/oauth/token-exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: {
      grant_type: TOKEN_EXCHANGE_GRANT_TYPE,
      actor_token: actorToken,
      delegation_grant_id: opts.delegationGrantId,
      audience: opts.audience ?? 'apes-cli',
    },
  })

  return res
}
