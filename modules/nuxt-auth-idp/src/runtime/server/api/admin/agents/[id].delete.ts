import { defineEventHandler, getRouterParam } from 'h3'
import { requireAdmin } from '../../../utils/admin'
import { useIdpStores } from '../../../utils/stores'
import { createProblemError } from '../../../utils/problem'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { userStore } = useIdpStores()

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createProblemError({ status: 400, title: 'User ID is required' })
  }

  const email = decodeURIComponent(id)
  const existing = await userStore.findByEmail(email)
  if (!existing) {
    throw createProblemError({ status: 404, title: 'User not found' })
  }

  await userStore.delete(email)
  return { ok: true }
})
