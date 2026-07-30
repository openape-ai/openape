import { randomUUID } from 'node:crypto'
import { defineEventHandler, getRequestIP, getRequestURL } from 'h3'
import { checkRateLimit } from '../../utils/rate-limiter'
import { sendAddDeviceEmail } from '../../utils/email'

// "Weiteres Gerät hinzufügen — Link verschicken" (#1097).
//
// Minted ONLY from an authenticated session and mailed ONLY to the
// account's own address: email is the transport that gets the link onto
// the new device, not an auth factor. That is why this token — unlike
// self-service registration tokens — may pass the #291 register gate.
// It is bound to the RP it was minted on (createdBy 'add-device:<rpID>',
// #1103) so a session on one tenant domain cannot mint a link that
// grafts a credential onto the same account on another tenant domain.

export default defineEventHandler(async (event) => {
  // requireAuth + useIdpStores + getRPConfig are auto-imported module utils.
  const email = await requireAuth(event)

  const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
  await checkRateLimit(email, ip)

  const { registrationUrlStore, userStore } = useIdpStores()
  const user = await userStore.findByEmail(email)

  const token = randomUUID()
  const now = Date.now()
  const oneHour = 60 * 60 * 1000

  await registrationUrlStore.save({
    token,
    email,
    name: user?.name ?? email,
    createdAt: now,
    expiresAt: now + oneHour,
    createdBy: `add-device:${getRPConfig().rpID}`,
    consumed: false,
  })

  const registerUrl = `${getRequestURL(event).origin}/register?token=${token}`
  await sendAddDeviceEmail(email, registerUrl)

  return { ok: true }
})
