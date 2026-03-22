import type { GrantType } from '@openape/core'
import type { ApproveGrantOverrides } from '@openape/grants'
import { approveGrant, issueAuthzJWT } from '@openape/grants'
import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { requireAuth } from '../../../utils/admin'
import { useGrantStores } from '../../../utils/grant-stores'
import { getIdpIssuer, useIdpStores } from '../../../utils/stores'
import { createProblemError } from '../../../utils/problem'

const VALID_GRANT_TYPES: GrantType[] = ['once', 'timed', 'always']

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const { grantStore } = useGrantStores()
  const { agentStore, keyStore } = useIdpStores()

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

  // Allow if the logged-in user is the requester themselves
  const isRequester = grant.request.requester === email
  if (!isRequester) {
    const agent = await agentStore.findByEmail(grant.request.requester)
    if (!agent) {
      throw createProblemError({ status: 403, title: 'Agent not found for this grant' })
    }
    const isOwnerOrApprover = agent.owner === email || agent.approver === email
    if (!isOwnerOrApprover) {
      throw createProblemError({ status: 403, title: 'Only the agent owner or approver can approve this grant' })
    }
  }

  const overrides: ApproveGrantOverrides | undefined = body.grant_type
    ? { grant_type: body.grant_type as GrantType, duration: body.duration as number | undefined }
    : undefined

  try {
    const approved = await approveGrant(id, email, grantStore, overrides)
    const signingKey = await keyStore.getSigningKey()
    const authzJwt = await issueAuthzJWT(approved, getIdpIssuer(), signingKey.privateKey, signingKey.kid)
    return { grant: approved, authz_jwt: authzJwt }
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to approve grant'
    throw createProblemError({ status: 400, title: message, type: 'https://openape.org/errors/grant_already_decided' })
  }
})
