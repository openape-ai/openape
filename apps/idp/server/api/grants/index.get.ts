import type { GrantStatus } from '@openape/core'
import { verifyBearerAuth } from '../../utils/bearer-auth'

export default defineEventHandler(async (event) => {
  const stores = await getStores()
  const config = getIdPConfig()

  const query = getQuery(event)
  const bearerPayload = await verifyBearerAuth(event, stores.keyStore, config.issuer)

  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100)
  const cursor = query.cursor ? String(query.cursor) : undefined
  const status = query.status ? String(query.status) as GrantStatus : undefined
  const requester = query.requester ? String(query.requester) : undefined

  if (requester) {
    return stores.grantStore.listGrants({ limit, cursor, status, requester })
  }

  if (!bearerPayload) {
    throw createProblemError({ status: 401, title: 'Bearer token required' })
  }
  const identity = bearerPayload.sub

  // Get self + owned agents -> single IN query
  const ownedUsers = await stores.userStore.findByOwner(identity)
  const requesters = [identity, ...ownedUsers.map(u => u.email)]

  return stores.grantStore.listGrants({ limit, cursor, status, requester: requesters })
})
