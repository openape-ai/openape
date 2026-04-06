import { requireManagementToken } from '../../../../utils/admin-auth'

export default defineEventHandler(async (event) => {
  const stores = await getStores()
  const config = getIdPConfig()

  requireManagementToken(event, config)

  const email = decodeURIComponent(getRouterParam(event, 'email')!)

  return await stores.sshKeyStore.findByUser(email)
})
