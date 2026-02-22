import { revokeGrant } from '@clawgate/server'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const { grantStore, agentStore } = useStores()

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
      throw createError({ statusCode: 403, statusMessage: 'Only the agent approver or admin can revoke this grant' })
    }
  }

  try {
    const revoked = await revokeGrant(id, grantStore)
    return revoked
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to revoke grant'
    throw createError({ statusCode: 400, statusMessage: message })
  }
})
