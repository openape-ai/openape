import type { GrantType, OpenApeGrantRequest } from '@ddisa/core'
import { createGrant } from '@openape/grants'

const VALID_GRANT_TYPES: GrantType[] = ['once', 'timed', 'always']

export default defineEventHandler(async (event) => {
  const body = await readBody<OpenApeGrantRequest>(event)
  const { grantStore } = useStores()

  // If agent token present, override requester with agent identity
  const agentPayload = await tryAgentAuth(event)
  if (agentPayload) {
    body.requester = `agent:${agentPayload.sub}`
  }

  if (!body.requester || !body.target || !body.grant_type) {
    throw createError({ statusCode: 400, statusMessage: 'Missing required fields: requester, target, grant_type' })
  }

  if (!VALID_GRANT_TYPES.includes(body.grant_type)) {
    throw createError({ statusCode: 400, statusMessage: `Invalid grant_type. Must be one of: ${VALID_GRANT_TYPES.join(', ')}` })
  }

  if (body.grant_type === 'timed' && !body.duration) {
    throw createError({ statusCode: 400, statusMessage: 'Duration is required for timed grants' })
  }

  const grant = await createGrant(body, grantStore)
  return grant
})
