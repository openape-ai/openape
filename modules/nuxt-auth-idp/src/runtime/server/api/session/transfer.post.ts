import { randomBytes } from 'node:crypto'
import { defineEventHandler, getRequestURL } from 'h3'
import { getAppSession } from '../../utils/session'
import { useGrantStorage } from '../../utils/grant-storage'
import { createProblemError } from '../../utils/problem'

// A signed-in browser hands its session to a browser that cannot run
// WebAuthn (agent panes, embedded Chromium, kiosks). The link is the
// credential, so it lives exactly as long as it takes to paste it.
const TTL_MS = 60_000

export default defineEventHandler(async (event) => {
  const session = await getAppSession(event)
  if (!session.data.userId) {
    throw createProblemError({ status: 401, title: 'Not authenticated' })
  }

  const token = randomBytes(32).toString('hex')
  // The whole session snapshot travels, not a field list: the target browser
  // must end up with the same identity and rights, and a copied list drifts.
  await useGrantStorage().setItem(`session-transfer:${token}`, {
    session: { ...session.data },
    expiresAt: Date.now() + TTL_MS,
  })

  return {
    url: `${getRequestURL(event).origin}/api/session/transfer/${token}`,
    expiresIn: TTL_MS / 1000,
  }
})
