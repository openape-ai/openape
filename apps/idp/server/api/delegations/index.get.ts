import type { OpenApeGrant } from '@openape/core'
import { verifyBearerAuth } from '../../utils/bearer-auth'

export default defineEventHandler(async (event) => {
  const stores = await getStores()
  const config = getIdPConfig()

  const bearerPayload = await verifyBearerAuth(event, stores.keyStore, config.issuer)
  if (!bearerPayload) {
    throw createProblemError({ status: 401, title: 'Bearer token required' })
  }
  const email = bearerPayload.sub

  const query = getQuery(event)
  const role = query.role as string | undefined
  const search = query.search as string | undefined
  const cursor = query.cursor as string | undefined
  const queryLimit = query.limit ? Number(query.limit) : undefined

  const grantStore = stores.grantStore

  let delegations: OpenApeGrant[]

  if (role === 'delegator') {
    if (!grantStore.findByDelegator) {
      throw createProblemError({ status: 501, title: 'Delegation queries not supported by this store' })
    }
    delegations = await grantStore.findByDelegator(email)
  }
  else if (role === 'delegate') {
    if (!grantStore.findByDelegate) {
      throw createProblemError({ status: 501, title: 'Delegation queries not supported by this store' })
    }
    delegations = await grantStore.findByDelegate(email)
  }
  else {
    // No role filter: return all delegations for this user (as delegator or delegate)
    const [asDelegator, asDelegate] = await Promise.all([
      grantStore.findByDelegator ? grantStore.findByDelegator(email) : [],
      grantStore.findByDelegate ? grantStore.findByDelegate(email) : [],
    ])

    const seen = new Set<string>()
    delegations = []
    for (const grant of [...asDelegator, ...asDelegate]) {
      if (!seen.has(grant.id)) {
        seen.add(grant.id)
        delegations.push(grant)
      }
    }
  }

  // Sort by created_at DESC
  delegations.sort((a, b) => b.created_at - a.created_at)

  // Search filter
  if (search) {
    const q = search.toLowerCase()
    delegations = delegations.filter(g =>
      g.request.delegator?.toLowerCase().includes(q)
      || g.request.delegate?.toLowerCase().includes(q)
      || g.request.audience?.toLowerCase().includes(q),
    )
  }

  // Cursor pagination (cursor = grant ID)
  if (cursor) {
    const idx = delegations.findIndex(g => g.id === cursor)
    if (idx >= 0) delegations = delegations.slice(idx + 1)
  }

  const limit = Math.min(Math.max(queryLimit ?? 50, 1), 100)
  const hasMore = delegations.length > limit
  const data = delegations.slice(0, limit)

  return {
    data,
    pagination: {
      cursor: data.length > 0 ? data.at(-1)!.id : null,
      has_more: hasMore,
    },
  }
})
