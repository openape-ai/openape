import { defineEventHandler, getRouterParam } from 'h3'
import { revokeGrant } from '@openape/grants'
import { useGrantStores } from '../../utils/grant-stores'
import { requireAuth } from '../../utils/admin'
import { createProblemError } from '../../utils/problem'

export default defineEventHandler(async (event) => {
  const email = await requireAuth(event)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createProblemError({ status: 400, title: 'Missing delegation ID' })
  }
  const { grantStore } = useGrantStores()
  const grant = await grantStore.findById(id)

  if (!grant || grant.type !== 'delegation') {
    throw createProblemError({ status: 404, title: 'Delegation not found' })
  }

  // Only the delegator can revoke their own delegation
  if (grant.request.delegator !== email) {
    throw createProblemError({ status: 403, title: 'Not authorized to revoke this delegation' })
  }

  const revoked = await revokeGrant(id, grantStore)
  return revoked
})
