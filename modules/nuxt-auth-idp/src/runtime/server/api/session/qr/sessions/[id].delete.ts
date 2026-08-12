import { defineEventHandler, getRouterParam } from 'h3'
import { getAppSession } from '../../../../utils/session'
import { useGrantStorage } from '../../../../utils/grant-storage'
import { createProblemError } from '../../../../utils/problem'
import { QR_TOKEN_RE, qrSessionKey } from '../../../../utils/qr-login'
import type { QrSession } from '../../../../utils/qr-login'

// Revoke a QR-transferred session: deleting the record kills the kiosk's
// cookie on its next request (utils/session.ts checks existence).
export default defineEventHandler(async (event) => {
  const session = await getAppSession(event)
  if (!session.data.userId) {
    throw createProblemError({ status: 401, title: 'Not authenticated' })
  }

  const id = getRouterParam(event, 'id') ?? ''
  if (!QR_TOKEN_RE.test(id)) {
    throw createProblemError({ status: 400, title: 'Malformed session id' })
  }

  const storage = useGrantStorage()
  const key = qrSessionKey(id)
  const stored = await storage.getItem<QrSession>(key)
  if (stored && stored.userId !== session.data.userId) {
    throw createProblemError({ status: 403, title: 'Not your session' })
  }

  await storage.removeItem(key)
  return { ok: true }
})
