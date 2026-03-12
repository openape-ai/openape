import { issueAuthzJWT } from '@openape/grants'
import { defineEventHandler, getRouterParam } from 'h3'
import { requireAgent } from '../../../utils/agent-auth'
import { useGrantStores } from '../../../utils/grant-stores'
import { getIdpIssuer, useIdpStores } from '../../../utils/stores'
import { createProblemError } from '../../../utils/problem'

export default defineEventHandler(async (event) => {
  const agentPayload = await requireAgent(event)
  const { grantStore } = useGrantStores()
  const { keyStore } = useIdpStores()

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createProblemError({ status: 400, title: 'Grant ID is required' })
  }

  const grant = await grantStore.findById(id)
  if (!grant) {
    throw createProblemError({ status: 404, title: 'Grant not found', type: 'https://openape.org/errors/grant_not_found' })
  }

  if (grant.request.requester !== agentPayload.sub) {
    throw createProblemError({ status: 403, title: 'Grant does not belong to this agent' })
  }

  if (grant.status !== 'approved') {
    throw createProblemError({ status: 400, title: `Grant is not approved (status: ${grant.status})`, type: 'https://openape.org/errors/grant_not_approved' })
  }

  const signingKey = await keyStore.getSigningKey()
  const authzJWT = await issueAuthzJWT(grant, getIdpIssuer(), signingKey.privateKey, signingKey.kid)

  return { authzJWT, grant }
})
