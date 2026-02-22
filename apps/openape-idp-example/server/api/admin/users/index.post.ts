export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const { userStore } = useStores()

  const body = await readBody<{ email: string; password: string; name: string }>(event)
  if (!body.email || !body.password || !body.name) {
    throw createError({ statusCode: 400, statusMessage: 'Missing required fields: email, password, name' })
  }

  const existing = await userStore.findByEmail(body.email)
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: 'User already exists' })
  }

  const user = await userStore.register(body.email, body.password, body.name)
  return { ok: true, email: user.email, name: user.name }
})
