import type { GrantType } from '@openape/core'
import type { ApproveGrantOverrides } from '@openape/grants'
import { approveGrant, issueAuthzJWT } from '@openape/grants'
import { verifyBearerAuth } from '../../../utils/bearer-auth'
import { hasManagementToken } from '../../../utils/admin-auth'

const VALID_GRANT_TYPES: GrantType[] = ['once', 'timed', 'always']

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

  const body = await readBody(event).catch(() => ({})) as Record<string, unknown>

  if (body.grant_type !== undefined) {
    if (!VALID_GRANT_TYPES.includes(body.grant_type as GrantType)) {
      throw createProblemError({ status: 400, title: `Invalid grant_type. Must be one of: ${VALID_GRANT_TYPES.join(', ')}` })
    }
    if (body.grant_type === 'timed' && (!body.duration || typeof body.duration !== 'number' || body.duration <= 0)) {
      throw createProblemError({ status: 400, title: 'Duration must be a positive number for timed grants' })
    }
  }

  const grant = await stores.grantStore.findById(id)
  if (!grant) {
    throw createProblemError({ status: 404, title: 'Grant not found' })
  }

  // Authorize: requester can self-approve, or owner/approver of the requester's agent
  if (email !== '_management_') {
    const isRequester = grant.request.requester === email
    if (!isRequester) {
      const requesterUser = await stores.userStore.findByEmail(grant.request.requester)
      if (!requesterUser) {
        throw createProblemError({ status: 403, title: 'Requester user not found for this grant' })
      }
      const isOwnerOrApprover = requesterUser.owner === email || requesterUser.approver === email
      if (!isOwnerOrApprover) {
        throw createProblemError({ status: 403, title: 'Only the requester, owner, or approver can approve this grant' })
      }
    }
  }

  try {
    const overrides: ApproveGrantOverrides | undefined = body.grant_type
      ? { grant_type: body.grant_type as GrantType, duration: body.duration as number | undefined }
      : undefined
    const approved = await approveGrant(id, email, stores.grantStore, overrides)

    const signingKey = await stores.keyStore.getSigningKey()
    const authzJwt = await issueAuthzJWT(approved, config.issuer, signingKey.privateKey, signingKey.kid)
    return { grant: approved, authz_jwt: authzJwt }
  }
  catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err) throw err
    const message = err instanceof Error ? err.message : 'Failed to approve grant'
    throw createProblemError({ status: 400, title: message })
  }
})
