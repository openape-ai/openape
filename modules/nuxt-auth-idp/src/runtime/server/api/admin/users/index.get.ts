import { defineEventHandler } from 'h3'
import { requireAdmin } from '../../../utils/admin'
import { useIdpStores } from '../../../utils/stores'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { userStore } = useIdpStores()
  const users = await userStore.listUsers()

  return {
    data: users,
    pagination: {
      total: users.length,
      page: 1,
      pageSize: users.length,
    },
  }
})
