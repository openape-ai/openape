export default defineEventHandler(async (event) => {
  const body = await readBody<{ email: string; password: string }>(event)
  const { userStore } = useStores()

  if (!body.email || !body.password) {
    throw createError({ statusCode: 400, statusMessage: 'Missing required fields: email, password' })
  }

  const user = await userStore.authenticate(body.email, body.password)

  if (user) {
    const session = await getAppSession(event)
    await session.update({ userId: user.email, userName: user.name })
    return { ok: true, email: user.email, name: user.name }
  }

  // Super-admin fallback: allow login with NUXT_SUPER_ADMIN_PASSWORD
  const config = useRuntimeConfig()
  if (config.superAdminPassword && body.password === config.superAdminPassword) {
    const session = await getAppSession(event)
    await session.update({ userId: body.email, userName: 'Super Admin', isSuperAdmin: true })
    return { ok: true, email: body.email, name: 'Super Admin' }
  }

  throw createError({ statusCode: 401, statusMessage: 'Invalid email or password' })
})
