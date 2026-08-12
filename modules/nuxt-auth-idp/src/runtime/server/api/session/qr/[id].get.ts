import { defineEventHandler, getRouterParam } from 'h3'
import { getAppSession } from '../../../utils/session'
import { useGrantStorage } from '../../../utils/grant-storage'
import { createProblemError } from '../../../utils/problem'
import { QR_TOKEN_RE, qrChannelKey } from '../../../utils/qr-login'
import type { QrChannel } from '../../../utils/qr-login'

// The approve page reads the requester context BEFORE the human decides.
// Cookie session only — this is the phone, and it must be a human's browser.
export default defineEventHandler(async (event) => {
  const session = await getAppSession(event)
  if (!session.data.userId) {
    throw createProblemError({ status: 401, title: 'Not authenticated' })
  }

  const id = getRouterParam(event, 'id') ?? ''
  if (!QR_TOKEN_RE.test(id)) {
    throw createProblemError({ status: 400, title: 'Malformed channel id' })
  }

  const stored = await useGrantStorage().getItem<QrChannel>(qrChannelKey(id))
  if (!stored || stored.expiresAt < Date.now()) {
    throw createProblemError({ status: 404, title: 'Sign-in code expired or unknown' })
  }

  return { state: stored.state, requester: stored.requester, expiresAt: stored.expiresAt }
})
