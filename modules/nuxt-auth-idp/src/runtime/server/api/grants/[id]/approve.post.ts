import type { GrantType, OpenApeCliAuthorizationDetail } from '@openape/core'
import type { ApproveGrantOverrides, ExtendMode } from '@openape/grants'
import { approveGrant, approveGrantWithExtension, approveGrantWithWidening, issueAuthzJWT } from '@openape/grants'
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

  // Management token bypasses authorization check.
  const isManagement = email === '_management_'
  if (!isManagement) {
    const requesterUser = await userStore.findByEmail(grant.request.requester)
    if (!requesterUser) {
      throw createProblemError({ status: 403, title: 'Requester not found for this grant' })
    }
    // Approver-policy resolution. Per the User type convention
    // (`packages/auth/src/idp/stores.ts:320`), `approver === undefined`
    // means "defaults to owner, or self when there is no owner". So:
    //
    //   approver explicitly set    -> only that approver (and the owner) may approve.
    //   approver unset, owner set  -> owner is the implicit approver (sub-user / agent).
    //   approver unset, owner unset -> top-level human, self-approval is implicit.
    //
    // The previous `isRequester` shortcut allowed *every* requester to
    // self-approve regardless of policy — that bypassed the entire
    // delegation model: an agent with only its 1h IdP token could mint
    // itself authz_jwt for arbitrary audiences without the human owner
    // ever being involved. See security audit 2026-05-04.
    const isOwner = requesterUser.owner !== undefined && requesterUser.owner === email
    const isExplicitApprover = requesterUser.approver !== undefined && requesterUser.approver === email
    const isImplicitSelfApprove
      = requesterUser.approver === undefined
      && requesterUser.owner === undefined
      && requesterUser.email === email
    if (!isOwner && !isExplicitApprover && !isImplicitSelfApprove) {
      throw createProblemError({ status: 403, title: 'Only the owner or approver can approve this grant' })
    }
  }

  // widened_details and extend_mode are mutually exclusive
  const hasWidenedDetails = Array.isArray(body.widened_details) && body.widened_details.length > 0
  const hasExtend = !!body.extend_mode && Array.isArray(body.extend_grant_ids) && body.extend_grant_ids.length > 0
  if (hasWidenedDetails && hasExtend) {
    throw createProblemError({
      status: 400,
      title: 'widened_details and extend_mode are mutually exclusive',
    })
  }

  try {
    let approved

    if (hasExtend) {
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
    else if (hasWidenedDetails) {
      approved = await approveGrantWithWidening(
        id,
        email,
        grantStore,
        body.widened_details as OpenApeCliAuthorizationDetail[],
        {
          grant_type: body.grant_type as GrantType | undefined,
          duration: body.duration as number | undefined,
        },
      )
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
