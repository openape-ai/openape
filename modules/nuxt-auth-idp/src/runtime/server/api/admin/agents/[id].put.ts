import { defineEventHandler, getRouterParam, readBody } from 'h3'
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

  const body = await readBody<{
    name?: string
    owner?: string
    approver?: string
    isActive?: boolean
  }>(event)

  const email = decodeURIComponent(id)
  const existing = await userStore.findByEmail(email)
  if (!existing) {
    throw createProblemError({ status: 404, title: 'User not found' })
  }

  const update: Record<string, unknown> = {}
  if (body.name !== undefined)
    update.name = body.name
  if (body.owner !== undefined)
    update.owner = body.owner
  if (body.approver !== undefined)
    update.approver = body.approver
  if (body.isActive !== undefined)
    update.isActive = body.isActive

  const user = await userStore.update(email, update)
  return user
})
