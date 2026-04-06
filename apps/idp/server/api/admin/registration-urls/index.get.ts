import { requireAdmin } from '../../../utils/admin-auth'

export default defineEventHandler(async (event) => {
  const stores = await getStores()
  const config = getIdPConfig()

  await requireAdmin(event, config)

  return await stores.registrationUrlStore.list()
})
