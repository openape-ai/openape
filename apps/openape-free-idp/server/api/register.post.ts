import { randomUUID } from 'node:crypto'
import { createError, defineEventHandler, getRequestIP, readBody } from 'h3'
import { checkRateLimit } from '../utils/rate-limiter'
import { sendExistingAccountEmail, sendRegistrationEmail } from '../utils/email'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: string }>(event)
  const email = body?.email?.trim().toLowerCase()

  if (!email || !/^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/.test(email)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid email' })
  }

  const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
  await checkRateLimit(email, ip)

  const { registrationUrlStore, credentialStore } = useIdpStores()
  const origin = getRequestURL(event).origin

  // Accounts that already have passkeys can't use a self-service token —
  // the #291 gate in webauthn/register/verify refuses it (mailbox
  // compromise alone must not graft a credential). Mailing them one
  // anyway was a dead end, so point them at the two working paths
  // instead: sign in on an enrolled device ("Email me a link", #1097) or
  // recovery. Response stays `{ok:true}` either way; that the mail
  // CONTENT reveals "account exists" only to the mailbox owner is the
  // same tradeoff every mail-based recovery flow makes.
  const existingCredentials = await credentialStore.findByUser(email)
  if (existingCredentials.length > 0) {
    await sendExistingAccountEmail(email, `${origin}/login`, `${origin}/recover/request`)
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

  const registerUrl = `${origin}/register?token=${token}`

  await sendRegistrationEmail(email, registerUrl)

  return { ok: true }
})
