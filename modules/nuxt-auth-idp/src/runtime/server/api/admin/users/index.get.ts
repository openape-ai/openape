import { defineEventHandler } from 'h3'
import { requireAdmin } from '../../../utils/admin'
import { useIdpStores } from '../../../utils/stores'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { userStore } = useIdpStores()
  return await userStore.listUsers()
})
