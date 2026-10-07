import { useBrokerStore } from '../../../utils/broker-store'
import type { GrantType, OpenApeCliAuthorizationDetail } from '@openape/core'
import type { ApproveGrantOverrides, ExtendMode } from '@openape/grants'
import { approveGrant, approveGrantWithExtension, approveGrantWithWidening, issueAuthzJWT } from '@openape/grants'
import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { requireAuth } from '../../../utils/admin'
import { requireGrantActionAuthority } from '../../../utils/grant-authority'
import { useGrantStores } from '../../../utils/grant-stores'
import { getIdpIssuer, useIdpStores } from '../../../utils/stores'
import { createProblemError } from '../../../utils/problem'

const VALID_GRANT_TYPES: GrantType[] = ['once', 'timed', 'always']

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const { grantStore } = useGrantStores()
  const { keyStore } = useIdpStores()

  if (!id) {
    throw createProblemError({ status: 400, title: 'Grant ID is required' })
  }

  const email = await requireAuth(event)

  const body = await readBody<Record<string, unknown>>(event) ?? {}
  if (typeof body !== 'object' || Array.isArray(body)) throw createProblemError({ status: 400, title: 'Approval body must be an object' })

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

  await requireGrantActionAuthority(event, grant, email, 'approve')

  // widened_details and extend_mode are mutually exclusive
  const hasWidenedDetails = Array.isArray(body.widened_details) && body.widened_details.length > 0
  const hasExtend = !!body.extend_mode && Array.isArray(body.extend_grant_ids) && body.extend_grant_ids.length > 0
  if (hasWidenedDetails && hasExtend) {
    throw createProblemError({
      status: 400,
      title: 'widened_details and extend_mode are mutually exclusive',
    })
  }

  if (grant.brokered && (hasWidenedDetails || hasExtend)) throw createProblemError({ status: 400, title: 'Brokered grants require a new request to change actions' })

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
    if (approved.brokered) await useBrokerStore(event).recordToken(approved)
    return { grant: approved, authz_jwt: authzJwt }
  }
  catch (err: unknown) {
    if (err && typeof err === 'object' && 'statusCode' in err) throw err
    const message = err instanceof Error ? err.message : 'Failed to approve grant'
    throw createProblemError({ status: 400, title: message, type: 'https://openape.org/errors/grant_already_decided' })
  }
})
