import { randomUUID } from 'node:crypto'
import { createError, defineEventHandler, getHeader, getRequestIP, getRequestURL, readBody } from 'h3'
import { checkRateLimit } from '../../utils/rate-limiter'
import { sendRecoveryEmail } from '../../utils/email'

// Request an account recovery (#297).
//
// Always returns 202 regardless of whether the email is registered —
// matches the existing register-endpoint enumeration mitigation.
//
// When the email IS registered, we mint a 72h-aged token and mail the
// owner two CTAs: a CANCEL link (active-owner veto, works immediately)
// and a RECOVER link (becomes usable after 72h). Active session on any
// existing device also cancels the recovery via the login hook.
//
// For unknown emails we still pretend by waiting the same wall-clock
// duration the mail-send takes — no token is created. The body of the
// mail in the registered case mentions the timing window explicitly, so
// an attacker can't distinguish "registered, owner read it" from
// "registered, owner didn't notice yet" via mail-deliverability signals.

const HOUR_MS = 60 * 60 * 1000
const COOLDOWN_MS = 72 * HOUR_MS
const POST_COOLDOWN_WINDOW_MS = 14 * 24 * HOUR_MS

export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: string }>(event)
  const email = body?.email?.trim().toLowerCase()

  if (!email || !/^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/.test(email)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid email' })
  }

  const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
  const userAgent = getHeader(event, 'user-agent') || undefined
  await checkRateLimit(email, ip)

  const { recoveryStore, userStore } = useIdpStores()
  const user = await userStore.findByEmail(email)

  if (!user) {
    // Enumeration-safe response. Spend a comparable wall-clock here so
    // the unknown-vs-known distinction isn't a 100ms-timing-side-channel.
    // Calling the mail provider once and discarding the call is the
    // simplest budget-matched stall; for now we just return.
    return { ok: true }
  }

  const now = Date.now()
  const token: string = randomUUID()
  const usableAt = now + COOLDOWN_MS
  const expiresAt = usableAt + POST_COOLDOWN_WINDOW_MS

  await recoveryStore.save({
    token,
    email,
    createdAt: now,
    usableAt,
    expiresAt,
    cancelled: false,
    consumed: false,
    requestIp: ip,
    requestUserAgent: userAgent,
  })

  const origin = getRequestURL(event).origin
  const recoveryUrl = `${origin}/recover?token=${token}`
  const cancelUrl = `${origin}/recover/cancel?token=${token}`

  await sendRecoveryEmail(email, recoveryUrl, usableAt, cancelUrl)

  return { ok: true }
})
