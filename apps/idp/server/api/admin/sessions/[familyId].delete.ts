import { requireAdmin } from '../../../utils/admin-auth'

export default defineEventHandler(async (event) => {
  const stores = await getStores()
  const config = getIdPConfig()

  await requireAdmin(event, config)

  const familyId = getRouterParam(event, 'familyId')
  if (!familyId) {
    throw createProblemError({ status: 400, title: 'Missing familyId' })
  }

  await stores.refreshTokenStore.revokeFamily(familyId)
  return { status: 'revoked', familyId }
})
