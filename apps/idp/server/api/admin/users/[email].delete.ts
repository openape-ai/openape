import { requireAdmin } from '../../../utils/admin-auth'

export default defineEventHandler(async (event) => {
  const stores = await getStores()
  const config = getIdPConfig()

  await requireAdmin(event, config)

  const email = decodeURIComponent(getRouterParam(event, 'email')!)
  const user = await stores.userStore.findByEmail(email)
  if (!user) {
    throw createProblemError({ status: 404, title: 'User not found' })
  }

  // Delete user's SSH keys first
  await stores.sshKeyStore.deleteAllForUser(email)
  await stores.userStore.delete(email)
  return { ok: true }
})
