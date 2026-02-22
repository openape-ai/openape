import { approveGrant, issueAuthzJWT } from '@openape/grants'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const { grantStore, agentStore, keyStore } = useStores()

  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Grant ID is required' })
  }

  const email = await requireAuth(event)

  // For agent grants, verify the user is the agent's approver or an admin
  const grant = await grantStore.findById(id)
  if (!grant) {
    throw createError({ statusCode: 404, statusMessage: 'Grant not found' })
  }

  if (grant.request.requester.startsWith('agent:')) {
    const agentId = grant.request.requester.slice(6)
    const agent = await agentStore.findById(agentId)
    if (agent && agent.approver !== email && !isAdmin(email)) {
      throw createError({ statusCode: 403, statusMessage: 'Only the agent approver or admin can approve this grant' })
    }
  }

  try {
    const approved = await approveGrant(id, email, grantStore)
    const signingKey = await keyStore.getSigningKey()
    const authzJWT = await issueAuthzJWT(approved, IDP_ISSUER, signingKey.privateKey, signingKey.kid)
    return { grant: approved, authzJWT }
  }
  catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to approve grant'
    throw createError({ statusCode: 400, statusMessage: message })
  }
})
