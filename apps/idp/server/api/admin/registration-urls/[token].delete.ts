import { requireAdmin } from '../../../utils/admin-auth'

export default defineEventHandler(async (event) => {
  const stores = await getStores()
  const config = getIdPConfig()

  await requireAdmin(event, config)

  const token = getRouterParam(event, 'token')
  if (!token) {
    throw createProblemError({ status: 400, title: 'Missing token' })
  }

  await stores.registrationUrlStore.delete(token)
  return { ok: true }
})
