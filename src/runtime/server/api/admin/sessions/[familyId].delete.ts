import { defineEventHandler, getRouterParam } from 'h3'
import { requireAdmin } from '../../../utils/admin'
import { useIdpStores } from '../../../utils/stores'
import { createProblemError } from '../../../utils/problem'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const familyId = getRouterParam(event, 'familyId')
  if (!familyId) {
    throw createProblemError({ status: 400, title: 'Missing familyId' })
  }
  const { refreshTokenStore } = useIdpStores()
  await refreshTokenStore.revokeFamily(familyId)
  return { status: 'revoked', familyId }
})
