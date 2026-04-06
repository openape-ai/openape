import { requireAdmin } from '../../../utils/admin-auth'

export default defineEventHandler(async (event) => {
  const stores = await getStores()
  const config = getIdPConfig()

  await requireAdmin(event, config)
  const query = getQuery(event)
  const result = await stores.userStore.list({
    limit: query.limit ? Number(query.limit) : undefined,
    cursor: query.cursor ? String(query.cursor) : undefined,
    search: query.search ? String(query.search) : undefined,
  })
  return {
    data: result.data.map(u => ({ email: u.email, name: u.name, isActive: u.isActive, owner: u.owner, createdAt: u.createdAt })),
    pagination: result.pagination,
  }
})
