import type { GrantStatus, OpenApeGrant } from '@openape/core'
import { createError, defineEventHandler, getQuery } from 'h3'
import { tryBearerAuth } from '../../utils/agent-auth'
import { useGrantStores } from '../../utils/grant-stores'
import { getAppSession } from '../../utils/session'
import { useIdpStores } from '../../utils/stores'

function isActiveGrant(g: OpenApeGrant): boolean {
  return g.status === 'pending' || (g.status === 'approved' && g.request.grant_type !== 'once')
}

export default defineEventHandler(async (event) => {
  const { grantStore } = useGrantStores()
  const { userStore } = useIdpStores()
  const query = getQuery(event)

  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100)
  const cursor = query.cursor ? String(query.cursor) : undefined
  const status = query.status ? String(query.status) as GrantStatus : undefined
  const requester = query.requester ? String(query.requester) : undefined
  const section = query.section ? String(query.section) : undefined
  const days = Math.min(Math.max(Number(query.days) || 7, 1), 90)

  // Authenticate FIRST — every list path requires it. (Historically the
  // `?requester=` branch short-circuited above this and leaked any user's
  // grants without auth.) Bearer token first, then session cookie.
  let email: string | undefined
  const bearerPayload = await tryBearerAuth(event)
  if (bearerPayload) {
    email = bearerPayload.sub
  }
  else {
    try {
      const session = await getAppSession(event)
      email = session.data.userId as string | undefined
    }
    catch {
      // Session may fail if secret is not configured
    }
  }
  if (!email) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }

  // The set of requesters this caller may see: itself + users it owns/approves.
  const ownedUsers = await userStore.findByOwner(email)
  const approvedUsers = await userStore.findByApprover(email)
  const requesters = [
    email,
    ...ownedUsers.map(u => u.email),
    ...approvedUsers.map(u => u.email),
  ]

  // Explicit `?requester=` filter: only allowed for a requester the caller may
  // see — otherwise 403 (no cross-user enumeration).
  if (requester) {
    if (!requesters.includes(requester)) {
      throw createError({ statusCode: 403, message: 'Not authorized to list grants for this requester' })
    }
    return await grantStore.listGrants({ limit, cursor, status, requester })
  }

  // Default paginated case: delegate to DB-level query with IN clause
  if (!section) {
    return await grantStore.listGrants({ limit, cursor, status, requester: requesters })
  }

  // Section queries need all user grants, then filter in-memory
  const { data: owned } = await grantStore.listGrants({ requester: requesters, limit: 10000 })

  // section=active
  if (section === 'active') {
    const active = owned.filter(isActiveGrant)
    return { data: active, pagination: { cursor: null, has_more: false } }
  }

  // section=history
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
})
