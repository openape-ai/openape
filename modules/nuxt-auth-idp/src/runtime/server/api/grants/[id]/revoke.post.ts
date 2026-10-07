import { revokeGrant } from '@openape/grants'
import { defineEventHandler, getRouterParam } from 'h3'
import { requireAuth } from '../../../utils/admin'
import { tryBearerAuth } from '../../../utils/agent-auth'
import { requireGrantActionAuthority } from '../../../utils/grant-authority'
import { useGrantStores } from '../../../utils/grant-stores'
import { createProblemError } from '../../../utils/problem'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const { grantStore } = useGrantStores()

  if (!id) {
    throw createProblemError({ status: 400, title: 'Grant ID is required' })
  }

  // Accept both bearer token and session auth
  const bearerPayload = await tryBearerAuth(event)
  const identity = bearerPayload?.sub ?? await requireAuth(event)

  const grant = await grantStore.findById(id)
  if (!grant) {
    throw createProblemError({ status: 404, title: 'Grant not found', type: 'https://openape.org/errors/grant_not_found' })
  }

  await requireGrantActionAuthority(event, grant, identity, 'revoke')

  try {
    const revoked = await revokeGrant(id, grantStore)
    return revoked
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to revoke grant'
    throw createProblemError({ status: 400, title: message, type: 'https://openape.org/errors/grant_already_decided' })
  }
})
