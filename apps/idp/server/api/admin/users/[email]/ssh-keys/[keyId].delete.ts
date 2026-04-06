import { requireManagementToken } from '../../../../../utils/admin-auth'

export default defineEventHandler(async (event) => {
  const stores = await getStores()
  const config = getIdPConfig()

  requireManagementToken(event, config)

  const keyId = getRouterParam(event, 'keyId')!

  const existing = await stores.sshKeyStore.findById(keyId)
  if (!existing) {
    throw createProblemError({ status: 404, title: 'SSH key not found' })
  }

  await stores.sshKeyStore.delete(keyId)
  return { ok: true }
})
