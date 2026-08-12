import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { getAppSession } from '../../../../utils/session'
import { useGrantStorage } from '../../../../utils/grant-storage'
import { createProblemError } from '../../../../utils/problem'
import { claimSecretMatches, QR_SESSION_TTL_MS, QR_TOKEN_RE, qrChannelKey, qrSessionKey } from '../../../../utils/qr-login'
import type { QrChannel, QrSession } from '../../../../utils/qr-login'

// The kiosk polls this until the phone has approved. Requires the
// claimSecret that only the channel creator holds — knowing the channelId
// from the QR alone must never be enough to walk away with the session.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const body = await readBody<{ claimSecret?: string }>(event)
  const claimSecret = body?.claimSecret ?? ''
  if (!QR_TOKEN_RE.test(id) || !QR_TOKEN_RE.test(claimSecret)) {
    throw createProblemError({ status: 400, title: 'Malformed channel id or claim secret' })
  }

  const storage = useGrantStorage()
  const key = qrChannelKey(id)
  const stored = await storage.getItem<QrChannel>(key)
  if (!stored || stored.expiresAt < Date.now()) {
    // Expired channels are dead either way; removing keeps storage clean.
    await storage.removeItem(key)
    throw createProblemError({ status: 401, title: 'Sign-in code expired or unknown' })
  }

  // A wrong secret does NOT burn the channel: an onlooker who photographed
  // the QR (and thus knows the channelId) must not be able to abort the
  // legitimate sign-in happening in front of the screen.
  if (!claimSecretMatches(claimSecret, stored.claimSecretHash)) {
    throw createProblemError({ status: 401, title: 'Invalid claim secret' })
  }

  if (stored.state !== 'approved' || !stored.session) {
    return { status: 'pending' as const }
  }

  // Removed before the session is written, so a replay cannot outlive the
  // first successful claim.
  await storage.removeItem(key)

  const now = Date.now()
  const qrSession: QrSession = {
    userId: stored.session.userId as string,
    requester: stored.requester,
    createdAt: now,
    expiresAt: now + QR_SESSION_TTL_MS,
  }
  // This record is the kill switch: the transferred session stays valid only
  // while it exists (enforced in utils/session.ts), so any signed-in device
  // can revoke the kiosk by deleting it.
  await storage.setItem(qrSessionKey(id), qrSession)

  const session = await getAppSession(event)
  await session.update({ ...stored.session, qrChannelId: id, qrExpiresAt: qrSession.expiresAt })

  return { status: 'ok' as const }
})
