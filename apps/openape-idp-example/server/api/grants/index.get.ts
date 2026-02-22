import type { OpenApeGrant } from '@ddisa/core'

export default defineEventHandler(async (event) => {
  const { grantStore, agentStore } = useStores()
  const query = getQuery(event)

  // Optional filter by requester (backward-compat)
  if (query.requester) {
    return await grantStore.findByRequester(String(query.requester))
  }

  // Check if user is authenticated
  const session = await getAppSession(event)
  if (!session.data.userId) {
    // Unauthenticated: backward-compat — return pending grants (for apes)
    return await grantStore.findPending()
  }

  const email = session.data.userId as string

  // Admin: see all grants
  if (isAdmin(email)) {
    return await grantStore.findAll()
  }

  // Authenticated user: see grants they're involved in
  const ownedAgents = await agentStore.findByOwner(email)
  const approvedAgents = await agentStore.findByApprover(email)
  const agentIds = new Set([
    ...ownedAgents.map((a) => a.id),
    ...approvedAgents.map((a) => a.id),
  ])

  const allGrants = await grantStore.findAll()
  return allGrants.filter((grant: OpenApeGrant) => {
    // Show grants targeting this user
    if (grant.request.target === email) return true
    // Show grants this user requested
    if (grant.request.requester === email) return true
    // Show grants from agents they own or approve
    if (grant.request.requester.startsWith('agent:')) {
      const agentId = grant.request.requester.slice(6)
      if (agentIds.has(agentId)) return true
    }
    // Show pending grants (they may need to approve)
    if (grant.status === 'pending') return true
    return false
  })
})
