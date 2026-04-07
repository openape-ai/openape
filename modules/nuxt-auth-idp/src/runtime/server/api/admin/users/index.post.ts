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

  if (body.email.length > 255) {
    throw createProblemError({ status: 400, title: 'Email must not exceed 255 characters' })
  }
  if (body.name.length > 255) {
    throw createProblemError({ status: 400, title: 'Name must not exceed 255 characters' })
  }

  const existing = await userStore.findByEmail(body.email)
  if (existing) {
    throw createProblemError({ status: 409, title: 'User already exists' })
  }

  const user = await userStore.create({
    email: body.email,
    name: body.name,
    isActive: true,
    createdAt: Math.floor(Date.now() / 1000),
  })
  return { ok: true, email: user.email, name: user.name }
})
