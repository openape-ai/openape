import { revokeGrant } from '@openape/grants'
import { verifyBearerAuth } from '../../utils/bearer-auth'

export default defineEventHandler(async (event) => {
  const stores = await getStores()
  const config = getIdPConfig()

  const bearerPayload = await verifyBearerAuth(event, stores.keyStore, config.issuer)
  if (!bearerPayload) {
    throw createProblemError({ status: 401, title: 'Bearer token required' })
  }
  const email = bearerPayload.sub

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createProblemError({ status: 400, title: 'Missing delegation ID' })
  }

  const grant = await stores.grantStore.findById(id)
  if (!grant || grant.type !== 'delegation') {
    throw createProblemError({ status: 404, title: 'Delegation not found' })
  }

  // Only the delegator can revoke their own delegation
  if (grant.request.delegator !== email) {
    throw createProblemError({ status: 403, title: 'Not authorized to revoke this delegation' })
  }

  try {
    const revoked = await revokeGrant(id, stores.grantStore)
    return revoked
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to revoke delegation'
    throw createProblemError({ status: 400, title: message })
  }
})
