import { defineEventHandler, getRouterParam } from 'h3'
import { getAppSession } from '../../../../utils/session'
import { useGrantStorage } from '../../../../utils/grant-storage'
import { createProblemError } from '../../../../utils/problem'
import { QR_TOKEN_RE, qrChannelKey } from '../../../../utils/qr-login'
import type { QrChannel } from '../../../../utils/qr-login'

// Approving hands a copy of this session to another machine. Cookie session
// ONLY, never Bearer: browser sessions are minted exclusively by human
// ceremonies (passkey, SSH signature), so this is act:'human' by
// construction — an agent token must never be able to approve a QR sign-in.
export default defineEventHandler(async (event) => {
  const session = await getAppSession(event)
  if (!session.data.userId) {
    throw createProblemError({ status: 401, title: 'Not authenticated' })
  }
  // No chaining (same rule as delegations): a session that itself arrived
  // via QR sits on an untrusted machine and must not spawn further copies.
  if (session.data.qrChannelId) {
    throw createProblemError({ status: 403, title: 'A QR sign-in session cannot approve another QR sign-in' })
  }

  const id = getRouterParam(event, 'id') ?? ''
  if (!QR_TOKEN_RE.test(id)) {
    throw createProblemError({ status: 400, title: 'Malformed channel id' })
  }

  const storage = useGrantStorage()
  const key = qrChannelKey(id)
  const stored = await storage.getItem<QrChannel>(key)
  if (!stored || stored.expiresAt < Date.now()) {
    throw createProblemError({ status: 404, title: 'Sign-in code expired or unknown' })
  }
  if (stored.state !== 'pending') {
    throw createProblemError({ status: 409, title: 'Sign-in code already approved' })
  }

  // The whole session snapshot travels, not a field list — same reasoning as
  // the session transfer: the kiosk must end up with the same identity and
  // rights, and a copied list drifts.
  const approved: QrChannel = { ...stored, state: 'approved', session: { ...session.data } }
  await storage.setItem(key, approved)

  return { ok: true }
})
