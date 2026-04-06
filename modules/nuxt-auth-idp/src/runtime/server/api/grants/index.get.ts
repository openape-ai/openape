import type { GrantStatus, OpenApeGrant } from '@openape/core'
import { defineEventHandler, getQuery } from 'h3'
import { useGrantStores } from '../../utils/grant-stores'
import { getAppSession } from '../../utils/session'
import { useIdpStores } from '../../utils/stores'

function isActiveGrant(g: OpenApeGrant): boolean {
  return g.status === 'pending' || (g.status === 'approved' && g.request.grant_type !== 'once')
}

export default defineEventHandler(async (event) => {
  const { grantStore } = useGrantStores()
  const { agentStore } = useIdpStores()
  const query = getQuery(event)

  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100)
  const cursor = query.cursor ? String(query.cursor) : undefined
  const status = query.status ? String(query.status) as GrantStatus : undefined
  const requester = query.requester ? String(query.requester) : undefined
  const section = query.section ? String(query.section) : undefined
  const days = Math.min(Math.max(Number(query.days) || 7, 1), 90)

  // If requesting by requester, use paginated list
  if (requester) {
    return await grantStore.listGrants({ limit, cursor, status, requester })
  }

  const session = await getAppSession(event)
  if (!session.data.userId) {
    return await grantStore.listGrants({ limit, cursor, status: status ?? 'pending' })
  }

  const email = session.data.userId as string

  // Collect all relevant requester identities in one array
  const ownedAgents = await agentStore.findByOwner(email)
  const approvedAgents = await agentStore.findByApprover(email)
  const allRequesters = [
    email,
    ...ownedAgents.map(a => a.email),
    ...approvedAgents.map(a => a.email),
  ]

  // Single query instead of findAll() + in-memory filter
  const { data: owned } = await grantStore.listGrants({
    requester: allRequesters,
    limit: 100,
  })

  // section=active → all pending + approved timed/always (no pagination)
  if (section === 'active') {
    const active = owned.filter(isActiveGrant)
    return { data: active, pagination: { cursor: null, has_more: false } }
  }

  // section=history → non-active grants, last N days, paginated
  if (section === 'history') {
    const cutoff = Math.floor(Date.now() / 1000) - days * 86400
    let history = owned.filter(g => !isActiveGrant(g) && g.created_at >= cutoff)

    if (status) {
      history = history.filter(g => g.status === status)
    }
    if (cursor) {
      const cursorTs = Number(cursor)
      const idx = history.findIndex(g => g.created_at < cursorTs)
      history = idx >= 0 ? history.slice(idx) : []
    }

    const page = history.slice(0, limit)
    const hasMore = history.length > limit

    return {
      data: page,
      pagination: {
        cursor: page.length > 0 ? String(page.at(-1)!.created_at) : null,
        has_more: hasMore,
      },
    }
  }

  // Default: backward-compatible — paginated all grants
  let filtered = owned
  if (status) {
    filtered = filtered.filter(g => g.status === status)
  }
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
