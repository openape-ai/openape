import { defineEventHandler, getRouterParam } from 'h3'
import { requireAdmin } from '../../../utils/admin'
import { useIdpStores } from '../../../utils/stores'
import { createProblemError } from '../../../utils/problem'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const token = getRouterParam(event, 'token')
  if (!token) {
    throw createProblemError({ status: 400, title: 'Missing token' })
  }

  const { registrationUrlStore } = useIdpStores()
  await registrationUrlStore.delete(token)
  return { ok: true }
})
