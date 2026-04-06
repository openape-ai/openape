import { denyGrant } from '@openape/grants'
import { verifyBearerAuth } from '../../../utils/bearer-auth'
import { hasManagementToken } from '../../../utils/admin-auth'

export default defineEventHandler(async (event) => {
  const stores = await getStores()
  const config = getIdPConfig()

  const id = getRouterParam(event, 'id')!

  const bearerPayload = await verifyBearerAuth(event, stores.keyStore, config.issuer)

  // Determine identity: management token or bearer
  let email: string
  if (hasManagementToken(event, config)) {
    email = '_management_'
  }
  else if (bearerPayload) {
    email = bearerPayload.sub
  }
  else {
    throw createProblemError({ status: 401, title: 'Bearer token required' })
  }

  const grant = await stores.grantStore.findById(id)
  if (!grant) {
    throw createProblemError({ status: 404, title: 'Grant not found' })
  }

  if (email !== '_management_') {
    const isRequester = grant.request.requester === email
    if (!isRequester) {
      const requesterUser = await stores.userStore.findByEmail(grant.request.requester)
      if (!requesterUser) {
        throw createProblemError({ status: 403, title: 'Requester user not found for this grant' })
      }
      const isOwnerOrApprover = requesterUser.owner === email || requesterUser.approver === email
      if (!isOwnerOrApprover) {
        throw createProblemError({ status: 403, title: 'Only the requester, owner, or approver can deny this grant' })
      }
    }
  }

  try {
    const denied = await denyGrant(id, email, stores.grantStore)
    return denied
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to deny grant'
    throw createProblemError({ status: 400, title: message })
  }
})
