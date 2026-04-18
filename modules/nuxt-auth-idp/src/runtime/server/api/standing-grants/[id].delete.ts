import { defineEventHandler, getRouterParam } from 'h3'
import { isStandingGrantRequest, revokeGrant } from '@openape/grants'
import { useGrantStores } from '../../utils/grant-stores'
import { requireAuth } from '../../utils/admin'
import { createProblemError } from '../../utils/problem'

/**
 * DELETE /api/standing-grants/:id
 *
 * Revokes a standing grant. Only the owner (original creator) may revoke.
 * Revocation flips status to 'revoked' — the audit row stays for trail.
 */
export default defineEventHandler(async (event) => {
  const owner = await requireAuth(event)
  const id = decodeURIComponent(getRouterParam(event, 'id') ?? '')
  if (!id) {
    throw createProblemError({ status: 400, title: 'Missing id' })
  }

  const { grantStore } = useGrantStores()
  const grant = await grantStore.findById(id)
  if (!grant || grant.type !== 'standing' || !isStandingGrantRequest(grant.request)) {
    throw createProblemError({ status: 404, title: 'Standing grant not found' })
  }
  if (grant.request.owner !== owner) {
    throw createProblemError({ status: 403, title: 'Not the owner of this standing grant' })
  }

  await revokeGrant(id, grantStore)
  return { ok: true }
})
