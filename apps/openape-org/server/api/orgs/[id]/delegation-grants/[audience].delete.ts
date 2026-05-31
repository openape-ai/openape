import { requireOwnedOrg } from '../../../../utils/orgs'
import { revokeDelegationGrant } from '../../../../utils/delegation-grants'

// Soft-revoke. The Owner SHOULD also revoke the grant at the IdP via
//   apes grants delegation-revoke <grant-id>
// so org can no longer use it even if its own DB still has the row.
// We document that in the UI; we don't try to call the IdP here
// because we don't have an authenticated Owner Bearer at this point.
export default defineEventHandler(async (event) => {
  const { owner } = await requireOwnedOrg(event)
  const audience = getRouterParam(event, 'audience')
  if (!audience) throw createError({ statusCode: 400, statusMessage: 'audience required' })
  await revokeDelegationGrant(owner, audience)
  return { ok: true }
})
