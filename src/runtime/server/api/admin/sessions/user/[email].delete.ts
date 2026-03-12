import { defineEventHandler, getRouterParam } from 'h3'
import { requireAdmin } from '../../../../utils/admin'
import { useIdpStores } from '../../../../utils/stores'
import { createProblemError } from '../../../../utils/problem'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const email = getRouterParam(event, 'email')
  if (!email) {
    throw createProblemError({ status: 400, title: 'Missing email' })
  }
  const { refreshTokenStore } = useIdpStores()
  await refreshTokenStore.revokeByUser(decodeURIComponent(email))
  return { status: 'revoked', email: decodeURIComponent(email) }
})
