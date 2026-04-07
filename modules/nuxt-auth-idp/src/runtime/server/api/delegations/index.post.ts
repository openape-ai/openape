import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { createDelegation } from '@openape/grants'
import { tryBearerAuth } from '../../utils/agent-auth'
import { useGrantStores } from '../../utils/grant-stores'
import { requireAuth } from '../../utils/admin'
import { createProblemError } from '../../utils/problem'

export default defineEventHandler(async (event) => {
  // Check act claim — only humans can create delegations
  const bearerPayload = await tryBearerAuth(event)
  if (bearerPayload && bearerPayload.act !== 'human') {
    throw createProblemError({ status: 403, title: 'Only humans can create delegations' })
  }
  const delegator = await requireAuth(event)
  const body = await readBody(event)

  if (!body.delegate || typeof body.delegate !== 'string') {
    throw createProblemError({ status: 400, title: 'Missing delegate' })
  }
  if (!body.audience || typeof body.audience !== 'string') {
    throw createProblemError({ status: 400, title: 'Missing audience' })
  }

  const grantType = body.grant_type || 'once'
  if (!['once', 'timed', 'always'].includes(grantType)) {
    throw createProblemError({ status: 400, title: 'Invalid grant_type' })
  }

  const { grantStore } = useGrantStores()

  const grant = await createDelegation({
    delegator,
    delegate: body.delegate,
    audience: body.audience,
    scopes: Array.isArray(body.scopes) ? body.scopes : undefined,
    grant_type: grantType,
    duration: typeof body.duration === 'number' ? body.duration : undefined,
  }, grantStore)

  setResponseStatus(event, 201)
  return grant
})
