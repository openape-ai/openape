import { requireAdmin } from '../../../../utils/admin-auth'

export default defineEventHandler(async (event) => {
  const stores = await getStores()
  const config = getIdPConfig()

  await requireAdmin(event, config)

  const email = getRouterParam(event, 'email')
  if (!email) {
    throw createProblemError({ status: 400, title: 'Missing email' })
  }

  await stores.refreshTokenStore.revokeByUser(decodeURIComponent(email))
  return { status: 'revoked', email: decodeURIComponent(email) }
})
