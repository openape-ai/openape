import type { GrantStatus, OpenApeGrant } from '@openape/core'
import { defineEventHandler, getQuery } from 'h3'
import { isAdmin } from '../../utils/admin'
import { useGrantStores } from '../../utils/grant-stores'
import { getAppSession } from '../../utils/session'
import { useIdpStores } from '../../utils/stores'

export default defineEventHandler(async (event) => {
  const { grantStore } = useGrantStores()
  const { agentStore } = useIdpStores()
  const query = getQuery(event)

  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100)
  const cursor = query.cursor ? String(query.cursor) : undefined
  const status = query.status ? String(query.status) as GrantStatus : undefined
  const requester = query.requester ? String(query.requester) : undefined

  // If requesting by requester, use paginated list
  if (requester) {
    return await grantStore.listGrants({ limit, cursor, status, requester })
  }

  const session = await getAppSession(event)
  if (!session.data.userId) {
    return await grantStore.listGrants({ limit, cursor, status: status ?? 'pending' })
  }

  const email = session.data.userId as string

  if (isAdmin(email)) {
    return await grantStore.listGrants({ limit, cursor, status })
  }

  // For non-admin users: filter by owned/approved agents + own grants
  const ownedAgents = await agentStore.findByOwner(email)
  const approvedAgents = await agentStore.findByApprover(email)
  const agentEmails = new Set([
    ...ownedAgents.map(a => a.email),
    ...approvedAgents.map(a => a.email),
  ])

  // Get all grants and filter, then paginate in-memory
  const allGrants = await grantStore.findAll()
  let filtered = allGrants.filter((grant: OpenApeGrant) => {
    if (grant.request.requester === email) return true
    if (agentEmails.has(grant.request.requester)) return true
    return false
  })

  if (status) {
    filtered = filtered.filter(g => g.status === status)
  }

  // Apply cursor
  if (cursor) {
    const cursorTs = Number(cursor)
    const idx = filtered.findIndex(g => g.created_at < cursorTs)
    filtered = idx >= 0 ? filtered.slice(idx) : []
  }

  const page = filtered.slice(0, limit)
  const hasMore = filtered.length > limit

  return {
    data: page,
    pagination: {
      cursor: page.length > 0 ? String(page.at(-1)!.created_at) : null,
      has_more: hasMore,
    },
  }
})
