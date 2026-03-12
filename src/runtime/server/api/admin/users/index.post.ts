import { defineEventHandler, readBody } from 'h3'
import { requireAdmin } from '../../../utils/admin'
import { useIdpStores } from '../../../utils/stores'
import { createProblemError } from '../../../utils/problem'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { userStore } = useIdpStores()

  const body = await readBody<{ email: string, name: string }>(event)
  if (!body.email || !body.name) {
    throw createProblemError({ status: 400, title: 'Missing required fields: email, name' })
  }

  const existing = await userStore.findByEmail(body.email)
  if (existing) {
    throw createProblemError({ status: 409, title: 'User already exists' })
  }

  const user = await userStore.create(body.email, body.name)
  return { ok: true, email: user.email, name: user.name }
})
