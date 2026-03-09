import { approveGrant, issueAuthzJWT } from '@openape/grants'
import { createError, defineEventHandler, getRouterParam } from 'h3'
import { isAdmin, requireAuth } from '../../../utils/admin'
import { useGrantStores } from '../../../utils/grant-stores'
import { getIdpIssuer, useIdpStores } from '../../../utils/stores'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const { grantStore } = useGrantStores()
  const { agentStore, keyStore } = useIdpStores()

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Grant ID is required' })
  }

  const email = await requireAuth(event)

  const grant = await grantStore.findById(id)
  if (!grant) {
    throw createError({ statusCode: 404, statusMessage: 'Grant not found' })
  }

  const agent = await agentStore.findByEmail(grant.request.requester)
  if (agent && agent.approver !== email && !isAdmin(email)) {
    throw createError({ statusCode: 403, statusMessage: 'Only the agent approver or admin can approve this grant' })
  }

  try {
    const approved = await approveGrant(id, email, grantStore)
    const signingKey = await keyStore.getSigningKey()
    const authzJWT = await issueAuthzJWT(approved, getIdpIssuer(), signingKey.privateKey, signingKey.kid)
    return { grant: approved, authzJWT }
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to approve grant'
    throw createError({ statusCode: 400, statusMessage: message })
  }
})
