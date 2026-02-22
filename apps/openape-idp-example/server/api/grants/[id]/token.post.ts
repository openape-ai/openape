import { issueAuthzJWT } from '@openape/grants'

export default defineEventHandler(async (event) => {
  const agentPayload = await requireAgent(event)
  const { grantStore, keyStore } = useStores()

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Grant ID is required' })
  }

  const grant = await grantStore.findById(id)
  if (!grant) {
    throw createError({ statusCode: 404, statusMessage: 'Grant not found' })
  }

  // Verify the grant belongs to this agent
  if (grant.request.requester !== `agent:${agentPayload.sub}`) {
    throw createError({ statusCode: 403, statusMessage: 'Grant does not belong to this agent' })
  }

  if (grant.status !== 'approved') {
    throw createError({ statusCode: 400, statusMessage: `Grant is not approved (status: ${grant.status})` })
  }

  const signingKey = await keyStore.getSigningKey()
  const authzJWT = await issueAuthzJWT(grant, IDP_ISSUER, signingKey.privateKey, signingKey.kid)

  return { authzJWT, grant }
})
