import { createError, defineEventHandler, readBody } from 'h3'
import { createDelegation } from '@openape/grants'
import { useGrantStores } from '../../utils/grant-stores'
import { getAppSession } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const session = await getAppSession(event)
  if (!session.data.userId) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const delegator = session.data.userId as string
  const body = await readBody(event)

  if (!body.delegate || typeof body.delegate !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Missing delegate' })
  }
  if (!body.audience || typeof body.audience !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Missing audience' })
  }

  const grantType = body.grant_type || 'once'
  if (!['once', 'timed', 'always'].includes(grantType)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid grant_type' })
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

  return grant
})
