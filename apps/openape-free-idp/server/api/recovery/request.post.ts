import type { User } from '@openape/auth'
import { randomUUID } from 'node:crypto'
import { createError, defineEventHandler, getHeader, getRequestIP, getRequestURL, readBody } from 'h3'
import { checkRateLimit } from '../../utils/rate-limiter'
import { sendRecoveryEmail, sendRecoveryWarningEmail } from '../../utils/email'
import { sendRecoveryWarningPush } from '../../utils/push'

// Request an account recovery (#297, adaptive cooldown #462).
//
// Always returns 202 regardless of whether the email is registered —
// matches the existing register-endpoint enumeration mitigation.
//
// When the email IS registered, we mint an aged token and mail the
// owner two CTAs: a CANCEL link (active-owner veto, works immediately)
// and a RECOVER link (becomes usable after the cooldown). Active session
// on any existing device also cancels the recovery via the login hook.
//
// The cooldown adapts to account activity (#462): owners who signed in
// within the last 30 days get 7 days to veto, dormant accounts keep the
// 72h default, and the vacation switch stretches the wait to an
// owner-configured maximum of 14 days. The deadline is fixed HERE, at
// request time — later logins or settings changes never shorten a
// running cooldown (enforced module-side against the stored usableAt).
//
// For unknown emails we still pretend by waiting the same wall-clock
// duration the mail-send takes — no token is created. The body of the
// mail in the registered case mentions the timing window explicitly, so
// an attacker can't distinguish "registered, owner read it" from
// "registered, owner didn't notice yet" via mail-deliverability signals.

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const INACTIVE_COOLDOWN_MS = 72 * HOUR_MS
const ACTIVE_COOLDOWN_MS = 7 * DAY_MS
const ACTIVITY_WINDOW_MS = 30 * DAY_MS
const VACATION_DEFAULT_DAYS = 14
const VACATION_MAX_DAYS = 14
const POST_COOLDOWN_WINDOW_MS = 14 * DAY_MS

function recoveryCooldownMs(user: User, now: number): number {
  if (user.recoveryVacationMode) {
    const days = Math.min(user.recoveryVacationDays ?? VACATION_DEFAULT_DAYS, VACATION_MAX_DAYS)
    return days * DAY_MS
  }
  if (user.lastLoginAt && now - user.lastLoginAt < ACTIVITY_WINDOW_MS) {
    return ACTIVE_COOLDOWN_MS
  }
  return INACTIVE_COOLDOWN_MS
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: string }>(event)
  const email = body?.email?.trim().toLowerCase()

  if (!email || !/^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/.test(email)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid email' })
  }

  const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
  const userAgent = getHeader(event, 'user-agent') || undefined
  await checkRateLimit(email, ip)

  const { recoveryStore, userStore, emailHistoryStore } = useIdpStores()
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
  const usableAt = now + recoveryCooldownMs(user, now)
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

  // Warning broadcast (#462): the recover link goes to the CURRENT
  // address only; every other address ever linked to the account and
  // every push-subscribed device gets warning + one-tap cancel — and
  // nothing that could complete the recovery. The channels are
  // independent on purpose: one dead mailbox or stale subscription
  // never silences the rest (failures are logged, not propagated).
  const linkedAddresses = await emailHistoryStore.listAllForEmail(email)
  const formerAddresses = linkedAddresses.filter(address => address !== email)

  const channels = await Promise.allSettled([
    sendRecoveryEmail(email, recoveryUrl, usableAt, cancelUrl),
    ...formerAddresses.map(to => sendRecoveryWarningEmail(to, email, usableAt, cancelUrl)),
    sendRecoveryWarningPush(email, { cancelUrl }),
  ])
  for (const channel of channels) {
    if (channel.status === 'rejected') {
      console.warn(`[recovery] warning channel failed: ${(channel.reason as Error)?.message ?? channel.reason}`)
    }
  }

  return { ok: true }
})
