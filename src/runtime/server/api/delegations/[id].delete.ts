import { createError, defineEventHandler, getRouterParam } from 'h3'
import { revokeGrant } from '@openape/grants'
import { useGrantStores } from '../../utils/grant-stores'
import { getAppSession } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const session = await getAppSession(event)
  if (!session.data.userId) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing delegation ID' })
  }

  const email = session.data.userId as string
  const { grantStore } = useGrantStores()
  const grant = await grantStore.findById(id)

  if (!grant || grant.type !== 'delegation') {
    throw createError({ statusCode: 404, statusMessage: 'Delegation not found' })
  }

  // Only the delegator can revoke their own delegation
  if (grant.request.delegator !== email) {
    throw createError({ statusCode: 403, statusMessage: 'Not authorized to revoke this delegation' })
  }

  const revoked = await revokeGrant(id, grantStore)
  return revoked
})
