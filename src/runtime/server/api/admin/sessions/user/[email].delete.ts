import { createError, defineEventHandler, getRouterParam } from 'h3'
import { requireAdmin } from '../../../../utils/admin'
import { useIdpStores } from '../../../../utils/stores'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const email = getRouterParam(event, 'email')
  if (!email) {
    throw createError({ statusCode: 400, statusMessage: 'Missing email' })
  }
  const { refreshTokenStore } = useIdpStores()
  await refreshTokenStore.revokeByUser(decodeURIComponent(email))
  return { status: 'revoked', email: decodeURIComponent(email) }
})
