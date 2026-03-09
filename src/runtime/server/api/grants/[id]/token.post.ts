import { issueAuthzJWT } from '@openape/grants'
import { createError, defineEventHandler, getRouterParam } from 'h3'
import { requireAgent } from '../../../utils/agent-auth'
import { useGrantStores } from '../../../utils/grant-stores'
import { getIdpIssuer, useIdpStores } from '../../../utils/stores'

export default defineEventHandler(async (event) => {
  const agentPayload = await requireAgent(event)
  const { grantStore } = useGrantStores()
  const { keyStore } = useIdpStores()

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Grant ID is required' })
  }

  const grant = await grantStore.findById(id)
  if (!grant) {
    throw createError({ statusCode: 404, statusMessage: 'Grant not found' })
  }

  if (grant.request.requester !== agentPayload.sub) {
    throw createError({ statusCode: 403, statusMessage: 'Grant does not belong to this agent' })
  }

  if (grant.status !== 'approved') {
    throw createError({ statusCode: 400, statusMessage: `Grant is not approved (status: ${grant.status})` })
  }

  const signingKey = await keyStore.getSigningKey()
  const authzJWT = await issueAuthzJWT(grant, getIdpIssuer(), signingKey.privateKey, signingKey.kid)

  return { authzJWT, grant }
})
