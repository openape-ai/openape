export default defineEventHandler(async (event) => {
  const body = await readBody<{ email: string, password: string }>(event)
  const { userStore } = useStores()

  if (!body.email || !body.password) {
    throw createError({ statusCode: 400, statusMessage: 'Missing required fields: email, password' })
  }

  const user = await userStore.authenticate(body.email, body.password)

  if (!user) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid email or password' })
  }

  const session = await getAppSession(event)
  await session.update({ userId: user.email, userName: user.name })
  return { ok: true, email: user.email, name: user.name }
})
