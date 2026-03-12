import { randomUUID } from 'node:crypto'
import { createError, defineEventHandler, getRequestIP, readBody } from 'h3'
import { checkRateLimit } from '../utils/rate-limiter'
import { sendRegistrationEmail } from '../utils/email'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: string }>(event)
  const email = body?.email?.trim().toLowerCase()

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid email' })
  }

  const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
  await checkRateLimit(email, ip)

  const { userStore, registrationUrlStore } = useIdpStores()

  // Silent return if user already exists (prevent email enumeration)
  const existing = await userStore.findByEmail(email)
  if (existing) {
    return { ok: true }
  }

  const token = randomUUID()
  const now = Date.now()
  const twentyFourHours = 24 * 60 * 60 * 1000

  await registrationUrlStore.save({
    token,
    email,
    name: email,
    createdAt: now,
    expiresAt: now + twentyFourHours,
    createdBy: 'self-service',
    consumed: false,
  })

  const origin = getRequestURL(event).origin
  const registerUrl = `${origin}/register?token=${token}`

  await sendRegistrationEmail(email, registerUrl)

  return { ok: true }
})
