import { defineEventHandler, getRouterParam, sendRedirect } from 'h3'
import { getAppSession } from '../../../utils/session'
import { useGrantStorage } from '../../../utils/grant-storage'
import { createProblemError } from '../../../utils/problem'

interface StoredTransfer {
  session: Record<string, unknown>
  expiresAt: number
}

export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token') ?? ''
  // The token is a storage key; only the shape we minted may reach unstorage.
  if (!/^[a-f0-9]{64}$/.test(token)) {
    throw createProblemError({ status: 400, title: 'Malformed transfer token' })
  }

  const storage = useGrantStorage()
  const key = `session-transfer:${token}`
  const stored = await storage.getItem<StoredTransfer>(key)
  // Removed before it is judged, so a replay cannot outlive the first attempt.
  await storage.removeItem(key)

  if (!stored || stored.expiresAt < Date.now()) {
    throw createProblemError({ status: 401, title: 'Transfer link expired or already used' })
  }

  const session = await getAppSession(event)
  await session.update(stored.session)

  // ponytail: a GET that signs you in is forced-login-able by anyone holding
  // a fresh token of their own. The 60s TTL is the defense; add a confirm
  // page ("Sign in as x@y?") if transfer links ever get a longer life.
  return sendRedirect(event, '/')
})
