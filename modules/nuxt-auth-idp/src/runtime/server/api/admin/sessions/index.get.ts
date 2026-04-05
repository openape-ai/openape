import { defineEventHandler, getQuery } from 'h3'
import { requireAdmin } from '../../../utils/admin'
import { useIdpStores } from '../../../utils/stores'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const query = getQuery(event)
  const userId = query.user as string | undefined
  const limit = query.limit ? Number(query.limit) : undefined
  const cursor = query.cursor as string | undefined
  const { refreshTokenStore } = useIdpStores()
  return await refreshTokenStore.listFamilies({ userId: userId || undefined, limit, cursor })
})
