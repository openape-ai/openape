import { z } from 'zod'
import { requireOwnedOrg } from '../../../../utils/orgs'
import { upsertDelegationGrant } from '../../../../utils/delegation-grants'

// Owner pastes a grant_id they obtained via:
//   apes grants delegate --to <orgIdpAgentEmail> --at apes-cli --approval always
// (or via the IdP UI). org persists it; from then on the spawn-proxy
// can mint Owner-scoped Bearers automatically via token-exchange.
const Body = z.object({
  audience: z.string().min(1).default('apes-cli'),
  grant_id: z.string().min(8).max(200),
})

export default defineEventHandler(async (event) => {
  const { owner } = await requireOwnedOrg(event)
  const parsed = Body.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'invalid body', data: parsed.error.flatten() })

  await upsertDelegationGrant({
    ownerEmail: owner,
    audience: parsed.data.audience,
    grantId: parsed.data.grant_id,
  })
  return { ok: true }
})
