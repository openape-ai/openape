import type { GrantType } from '@openape/core'
import type { ApproveGrantOverrides, ExtendMode } from '@openape/grants'
import { approveGrant, approveGrantWithExtension, issueAuthzJWT } from '@openape/grants'
import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { requireAuth } from '../../../utils/admin'
import { useGrantStores } from '../../../utils/grant-stores'
import { getIdpIssuer, useIdpStores } from '../../../utils/stores'
import { createProblemError } from '../../../utils/problem'

const VALID_GRANT_TYPES: GrantType[] = ['once', 'timed', 'always']

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const { grantStore } = useGrantStores()
  const { userStore, keyStore } = useIdpStores()

  if (!id) {
    throw createProblemError({ status: 400, title: 'Grant ID is required' })
  }

  const email = await requireAuth(event)

  const body = await readBody(event).catch(() => ({})) as Record<string, unknown>

  // Validate overrides if provided
  if (body.grant_type !== undefined) {
    if (!VALID_GRANT_TYPES.includes(body.grant_type as GrantType)) {
      throw createProblemError({ status: 400, title: `Invalid grant_type. Must be one of: ${VALID_GRANT_TYPES.join(', ')}` })
    }
    if (body.grant_type === 'timed' && (!body.duration || typeof body.duration !== 'number' || body.duration <= 0)) {
      throw createProblemError({ status: 400, title: 'Duration must be a positive number for timed grants' })
    }
  }

  const grant = await grantStore.findById(id)
  if (!grant) {
    throw createProblemError({ status: 404, title: 'Grant not found', type: 'https://openape.org/errors/grant_not_found' })
  }

  // Management token bypasses authorization check
  const isManagement = email === '_management_'
  // Allow if the logged-in user is the requester themselves
  const isRequester = grant.request.requester === email
  if (!isManagement && !isRequester) {
    const requesterUser = await userStore.findByEmail(grant.request.requester)
    if (!requesterUser) {
      throw createProblemError({ status: 403, title: 'Requester not found for this grant' })
    }
    const isOwnerOrApprover = requesterUser.owner === email || requesterUser.approver === email
    if (!isOwnerOrApprover) {
      throw createProblemError({ status: 403, title: 'Only the owner or approver can approve this grant' })
    }
  }

  try {
    let approved

    if (body.extend_mode && Array.isArray(body.extend_grant_ids) && body.extend_grant_ids.length > 0) {
      const validModes: ExtendMode[] = ['widen', 'merge']
      if (!validModes.includes(body.extend_mode as ExtendMode)) {
        throw createProblemError({ status: 400, title: 'Invalid extend_mode. Must be "widen" or "merge"' })
      }

      approved = await approveGrantWithExtension(id, email, grantStore, {
        grant_type: body.grant_type as GrantType | undefined,
        duration: body.duration as number | undefined,
        extend_mode: body.extend_mode as ExtendMode,
        extend_grant_ids: body.extend_grant_ids as string[],
      })
    }
    else {
      const overrides: ApproveGrantOverrides | undefined = body.grant_type
        ? { grant_type: body.grant_type as GrantType, duration: body.duration as number | undefined }
        : undefined
      approved = await approveGrant(id, email, grantStore, overrides)
    }

    const signingKey = await keyStore.getSigningKey()
    const authzJwt = await issueAuthzJWT(approved, getIdpIssuer(), signingKey.privateKey, signingKey.kid)
    return { grant: approved, authz_jwt: authzJwt }
  }
  catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err) throw err
    const message = err instanceof Error ? err.message : 'Failed to approve grant'
    throw createProblemError({ status: 400, title: message, type: 'https://openape.org/errors/grant_already_decided' })
  }
})
