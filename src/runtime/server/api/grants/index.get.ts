import type { OpenApeGrant } from '@openape/core'
import { defineEventHandler, getQuery } from 'h3'
import { isAdmin } from '../../utils/admin'
import { useGrantStores } from '../../utils/grant-stores'
import { getAppSession } from '../../utils/session'
import { useIdpStores } from '../../utils/stores'

export default defineEventHandler(async (event) => {
  const { grantStore } = useGrantStores()
  const { agentStore } = useIdpStores()
  const query = getQuery(event)

  if (query.requester) {
    return await grantStore.findByRequester(String(query.requester))
  }

  const session = await getAppSession(event)
  if (!session.data.userId) {
    return await grantStore.findPending()
  }

  const email = session.data.userId as string

  if (isAdmin(email)) {
    return await grantStore.findAll()
  }

  const ownedAgents = await agentStore.findByOwner(email)
  const approvedAgents = await agentStore.findByApprover(email)
  const agentEmails = new Set([
    ...ownedAgents.map(a => a.email),
    ...approvedAgents.map(a => a.email),
  ])

  const allGrants = await grantStore.findAll()
  return allGrants.filter((grant: OpenApeGrant) => {
    if (grant.request.target === email)
      return true
    if (grant.request.requester === email)
      return true
    if (agentEmails.has(grant.request.requester))
      return true
    if (grant.status === 'pending')
      return true
    return false
  })
})
