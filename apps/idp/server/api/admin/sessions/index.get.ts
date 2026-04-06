import { requireAdmin } from '../../../utils/admin-auth'

export default defineEventHandler(async (event) => {
  const stores = await getStores()
  const config = getIdPConfig()

  await requireAdmin(event, config)

  const query = getQuery(event)
  const userId = query.user ? String(query.user) : undefined
  const limit = query.limit ? Number(query.limit) : undefined
  const cursor = query.cursor ? String(query.cursor) : undefined

  return await stores.refreshTokenStore.listFamilies({ userId, limit, cursor })
})
