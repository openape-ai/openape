import { requireAdmin } from '../../../utils/admin-auth'

export default defineEventHandler(async (event) => {
  const stores = await getStores()
  const config = getIdPConfig()

  await requireAdmin(event, config)

  const body = await readBody<{ email: string, name: string, password?: string }>(event)
  if (!body.email || !body.name) {
    throw createProblemError({ status: 400, title: 'Missing required fields: email, name' })
  }

  // Input length validation
  if (body.email.length > 255) {
    throw createProblemError({ status: 400, title: 'Email must not exceed 255 characters' })
  }
  if (body.name.length > 255) {
    throw createProblemError({ status: 400, title: 'Name must not exceed 255 characters' })
  }

  const existing = await stores.userStore.findByEmail(body.email)
  if (existing) {
    throw createProblemError({ status: 409, title: 'User already exists' })
  }

  const user = await stores.userStore.create({
    email: body.email,
    name: body.name,
    isActive: true,
    createdAt: Date.now(),
  })
  return { ok: true, email: user.email, name: user.name }
})
