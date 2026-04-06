import { revokeGrant } from '@openape/grants'
import { verifyBearerAuth } from '../../../utils/bearer-auth'
import { hasManagementToken } from '../../../utils/admin-auth'

export default defineEventHandler(async (event) => {
  const stores = await getStores()
  const config = getIdPConfig()

  const id = getRouterParam(event, 'id')!

  const bearerPayload = await verifyBearerAuth(event, stores.keyStore, config.issuer)

  // Determine identity: management token or bearer
  let identity: string
  if (hasManagementToken(event, config)) {
    identity = '_management_'
  }
  else if (bearerPayload) {
    identity = bearerPayload.sub
  }
  else {
    throw createProblemError({ status: 401, title: 'Bearer token required' })
  }

  const grant = await stores.grantStore.findById(id)
  if (!grant) {
    throw createProblemError({ status: 404, title: 'Grant not found' })
  }

  if (identity !== '_management_') {
    const isRequester = grant.request.requester === identity
    if (!isRequester) {
      const requesterUser = await stores.userStore.findByEmail(grant.request.requester)
      const isApprover = requesterUser && requesterUser.approver === identity
      const isAdmin = config.adminEmails?.includes(identity)
      if (!isApprover && !isAdmin) {
        throw createProblemError({ status: 403, title: 'Only the requester, approver, or admin can revoke this grant' })
      }
    }
  }

  try {
    const revoked = await revokeGrant(id, stores.grantStore)
    return revoked
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to revoke grant'
    throw createProblemError({ status: 400, title: message })
  }
})
