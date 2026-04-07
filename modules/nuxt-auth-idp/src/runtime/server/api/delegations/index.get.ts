import { defineEventHandler, getQuery } from 'h3'
import { useGrantStores } from '../../utils/grant-stores'
import { requireAuth } from '../../utils/admin'

function paginate(all: unknown[], limit: number, cursor?: string) {
  let filtered = all as { created_at: number }[]
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
}

export default defineEventHandler(async (event) => {
  const email = await requireAuth(event)
  const { grantStore } = useGrantStores()

  const query = getQuery(event)
  const role = query.role as string | undefined
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100)
  const cursor = query.cursor ? String(query.cursor) : undefined

  if (role === 'delegator') {
    const results = await grantStore.findByDelegator(email)
    results.sort((a, b) => b.created_at - a.created_at)
    return paginate(results, limit, cursor)
  }

  if (role === 'delegate') {
    const results = await grantStore.findByDelegate(email)
    results.sort((a, b) => b.created_at - a.created_at)
    return paginate(results, limit, cursor)
  }

  const [asDelegator, asDelegate] = await Promise.all([
    grantStore.findByDelegator(email),
    grantStore.findByDelegate(email),
  ])

  // Merge and deduplicate
  const seen = new Set<string>()
  const results = []
  for (const grant of [...asDelegator, ...asDelegate]) {
    if (!seen.has(grant.id)) {
      seen.add(grant.id)
      results.push(grant)
    }
  }

  results.sort((a, b) => b.created_at - a.created_at)
  return paginate(results, limit, cursor)
})
