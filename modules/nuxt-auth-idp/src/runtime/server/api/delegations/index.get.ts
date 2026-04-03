import { defineEventHandler, getQuery } from 'h3'
import { useGrantStores } from '../../utils/grant-stores'
import { requireAuth } from '../../utils/admin'

export default defineEventHandler(async (event) => {
  const email = await requireAuth(event)
  const { grantStore } = useGrantStores()

  const query = getQuery(event)
  const role = query.role as string | undefined

  if (role === 'delegator') {
    const results = await grantStore.findByDelegator(email)
    return results.sort((a, b) => b.created_at - a.created_at)
  }

  if (role === 'delegate') {
    const results = await grantStore.findByDelegate(email)
    return results.sort((a, b) => b.created_at - a.created_at)
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

  return results.sort((a, b) => b.created_at - a.created_at)
})
