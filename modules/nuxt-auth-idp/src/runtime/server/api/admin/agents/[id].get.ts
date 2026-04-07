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

  const user = await userStore.findByEmail(decodeURIComponent(id))
  if (!user) {
    throw createProblemError({ status: 404, title: 'User not found' })
  }

  return user
})
