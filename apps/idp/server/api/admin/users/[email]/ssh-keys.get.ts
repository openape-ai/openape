import { requireAdmin } from '../../../../utils/admin-auth'

export default defineEventHandler(async (event) => {
  const stores = await getStores()
  const config = getIdPConfig()

  await requireAdmin(event, config)

  const email = decodeURIComponent(getRouterParam(event, 'email')!)

  return await stores.sshKeyStore.findByUser(email)
})
