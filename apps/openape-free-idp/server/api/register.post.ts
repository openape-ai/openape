import { randomUUID } from 'node:crypto'
import { createError, defineEventHandler, getRequestIP, readBody } from 'h3'
import { checkRateLimit } from '../utils/rate-limiter'
import { sendRegistrationEmail } from '../utils/email'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: string }>(event)
  const email = body?.email?.trim().toLowerCase()

  if (!email || !/^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/.test(email)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid email' })
  }

  const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
  await checkRateLimit(email, ip)

  const { registrationUrlStore } = useIdpStores()

  // We always issue a registration token + send a mail, even for existing
  // users. The verify endpoint (`webauthn/register/verify.post.ts`) already
  // handles both new-user and existing-user cases idempotently: it only
  // creates the user record if missing and otherwise just appends the new
  // credential. This makes "lost passkey / new device / new RP-domain" a
  // self-service recovery flow instead of an admin-only ticket.
  //
  // Email-enumeration protection is preserved at the response layer: both
  // unknown and known emails get the same `{ok:true}` response and the same
  // mail-send latency. The mail content is identical for both cases, so an
  // attacker who controls a victim's mailbox can't infer "this email is
  // registered" any more easily than via any normal mail-based recovery flow.
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
