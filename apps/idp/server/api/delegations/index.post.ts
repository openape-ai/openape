import type { GrantType } from '@openape/core'
import { createDelegation } from '@openape/grants'
import { verifyBearerAuth } from '../../utils/bearer-auth'

const VALID_GRANT_TYPES: GrantType[] = ['once', 'timed', 'always']

export default defineEventHandler(async (event) => {
  const stores = await getStores()
  const config = getIdPConfig()

  const bearerPayload = await verifyBearerAuth(event, stores.keyStore, config.issuer)
  if (!bearerPayload) {
    throw createProblemError({ status: 401, title: 'Bearer token required' })
  }
  if (bearerPayload.act !== 'human') {
    throw createProblemError({ status: 403, title: 'Only human users may create delegations' })
  }
  const delegator = bearerPayload.sub

  const body = await readBody(event)

  if (!body?.delegate || typeof body.delegate !== 'string') {
    throw createProblemError({ status: 400, title: 'Missing delegate' })
  }
  if (!body?.audience || typeof body.audience !== 'string') {
    throw createProblemError({ status: 400, title: 'Missing audience' })
  }

  const grantType = body.grant_type || 'once'
  if (!VALID_GRANT_TYPES.includes(grantType)) {
    throw createProblemError({ status: 400, title: `Invalid grant_type. Must be one of: ${VALID_GRANT_TYPES.join(', ')}` })
  }

  if (grantType === 'timed' && (!body.duration || typeof body.duration !== 'number')) {
    throw createProblemError({ status: 400, title: 'Duration is required for timed grants' })
  }

  const grant = await createDelegation({
    delegator,
    delegate: body.delegate,
    audience: body.audience,
    scopes: Array.isArray(body.scopes) ? body.scopes : undefined,
    grant_type: grantType,
    duration: typeof body.duration === 'number' ? body.duration : undefined,
  }, stores.grantStore)

  setResponseStatus(event, 201)
  return grant
})
