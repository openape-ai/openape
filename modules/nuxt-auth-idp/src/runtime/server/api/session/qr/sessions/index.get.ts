import { defineEventHandler } from 'h3'
import { getAppSession } from '../../../../utils/session'
import { useGrantStorage } from '../../../../utils/grant-storage'
import { createProblemError } from '../../../../utils/problem'
import type { QrSession } from '../../../../utils/qr-login'

// List the caller's kiosks that signed in via QR — the account page renders
// these with a revoke button. Expired records are pruned on the way.
export default defineEventHandler(async (event) => {
  const session = await getAppSession(event)
  if (!session.data.userId) {
    throw createProblemError({ status: 401, title: 'Not authenticated' })
  }

  const storage = useGrantStorage()
  const keys = await storage.getKeys('qr-session')
  const sessions: Array<QrSession & { id: string }> = []
  for (const key of keys) {
    const stored = await storage.getItem<QrSession>(key)
    if (!stored) continue
    if (stored.expiresAt < Date.now()) {
      await storage.removeItem(key)
      continue
    }
    if (stored.userId !== session.data.userId) continue
    sessions.push({ id: key.split(':').pop()!, ...stored })
  }
  return sessions
})
