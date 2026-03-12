import { defineEventHandler, readBody } from 'h3'
import { requireAdmin } from '../../../utils/admin'
import { getRPConfig } from '../../../utils/rp-config'
import { useIdpStores } from '../../../utils/stores'
import { createProblemError } from '../../../utils/problem'

export default defineEventHandler(async (event) => {
  const adminEmail = await requireAdmin(event)
  const body = await readBody<{ email: string, name: string, expiresInHours?: number }>(event)

  if (!body.email || !body.name) {
    throw createProblemError({ status: 400, title: 'Missing required fields: email, name' })
  }

  const { registrationUrlStore } = useIdpStores()

  const token = crypto.randomUUID()
  const expiresInHours = body.expiresInHours || 24

  await registrationUrlStore.save({
    token,
    email: body.email,
    name: body.name,
    createdAt: Date.now(),
    expiresAt: Date.now() + expiresInHours * 60 * 60 * 1000,
    createdBy: adminEmail,
    consumed: false,
  })

  const rpConfig = getRPConfig()
  const registrationUrl = `${rpConfig.origin}/register?token=${token}`

  return { ok: true, token, registrationUrl, expiresInHours }
})
