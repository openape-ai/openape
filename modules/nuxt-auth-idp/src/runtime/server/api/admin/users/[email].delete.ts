import { defineEventHandler, getRouterParam } from 'h3'
import { requireAdmin } from '../../../utils/admin'
import { useIdpStores } from '../../../utils/stores'
import { createProblemError } from '../../../utils/problem'

export default defineEventHandler(async (event) => {
  const adminEmail = await requireAdmin(event)
  const { userStore } = useIdpStores()

  const email = getRouterParam(event, 'email')
  if (!email) {
    throw createProblemError({ status: 400, title: 'Email is required' })
  }

  const decoded = decodeURIComponent(email)

  if (decoded === adminEmail) {
    throw createProblemError({ status: 400, title: 'Cannot delete your own account' })
  }

  const existing = await userStore.findByEmail(decoded)
  if (!existing) {
    throw createProblemError({ status: 404, title: 'User not found' })
  }

  await userStore.deleteUser(decoded)
  return { ok: true }
})
