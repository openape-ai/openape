import { createError, defineEventHandler, getRouterParam } from 'h3'
import { requireAdmin } from '../../../utils/admin'
import { useIdpStores } from '../../../utils/stores'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const familyId = getRouterParam(event, 'familyId')
  if (!familyId) {
    throw createError({ statusCode: 400, statusMessage: 'Missing familyId' })
  }
  const { refreshTokenStore } = useIdpStores()
  await refreshTokenStore.revokeFamily(familyId)
  return { status: 'revoked', familyId }
})
