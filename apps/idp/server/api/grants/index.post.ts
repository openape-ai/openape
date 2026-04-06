import type { GrantType, OpenApeGrantRequest } from '@openape/core'
import { createGrant } from '@openape/grants'
import { verifyBearerAuth } from '../../utils/bearer-auth'

const VALID_GRANT_TYPES: GrantType[] = ['once', 'timed', 'always']

export default defineEventHandler(async (event) => {
  const stores = await getStores()
  const config = getIdPConfig()

  const body = await readBody<OpenApeGrantRequest>(event)
  const bearerPayload = await verifyBearerAuth(event, stores.keyStore, config.issuer)

  if (bearerPayload) {
    body.requester = bearerPayload.sub
  }

  if (!body.requester || !body.target_host || !body.audience) {
    throw createProblemError({ status: 400, title: 'Missing required fields: requester, target_host, audience' })
  }

  if (!body.grant_type) {
    body.grant_type = 'once'
  }

  if (!VALID_GRANT_TYPES.includes(body.grant_type)) {
    throw createProblemError({ status: 400, title: `Invalid grant_type. Must be one of: ${VALID_GRANT_TYPES.join(', ')}` })
  }

  if (body.grant_type === 'timed' && !body.duration) {
    throw createProblemError({ status: 400, title: 'Duration is required for timed grants' })
  }

  const grant = await createGrant(body, stores.grantStore)
  setResponseStatus(event, 201)
  return grant
})
