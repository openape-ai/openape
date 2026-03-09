import { createError, defineEventHandler } from 'h3'
import { useGrantStores } from '../../utils/grant-stores'
import { getAppSession } from '../../utils/session'

export default defineEventHandler(async (event) => {
  const session = await getAppSession(event)
  if (!session.data.userId) {
    throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  }

  const email = session.data.userId as string
  const { grantStore } = useGrantStores()

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
