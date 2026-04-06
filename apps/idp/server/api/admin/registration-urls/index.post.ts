import { requireAdmin } from '../../../utils/admin-auth'

export default defineEventHandler(async (event) => {
  const stores = await getStores()
  const config = getIdPConfig()

  await requireAdmin(event, config)

  const body = await readBody<{ email: string, name: string, expiresInHours?: number }>(event)

  if (!body.email || !body.name) {
    throw createProblemError({ status: 400, title: 'Missing required fields: email, name' })
  }

  const token = crypto.randomUUID()
  const expiresInHours = body.expiresInHours || 24

  await stores.registrationUrlStore.save({
    token,
    email: body.email,
    name: body.name,
    createdAt: Date.now(),
    expiresAt: Date.now() + expiresInHours * 60 * 60 * 1000,
    createdBy: 'admin',
    consumed: false,
  })

  const registrationUrl = `${config.issuer}/register?token=${token}`

  return { ok: true, token, registrationUrl, expiresInHours }
})
