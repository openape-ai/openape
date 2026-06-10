import { defineEventHandler, readBody } from 'h3'
import { getAppSession } from '../../utils/session'
import { useIdpStores } from '../../utils/stores'
import { createProblemError } from '../../utils/problem'

// Cancel pending recoveries (#297, one-tap cancel #462).
//
// Two ways in, both ending in the same active-owner veto:
//
// 1. Tokenized (no session): the warning mail/push carries a
//    /recover/cancel?token=… link minted at request time. Whoever
//    holds it can kill the attempt instantly — without signing in —
//    for the entire waiting period. The token cancels, and ONLY
//    cancels: it never authenticates, never completes a recovery,
//    and the response carries no secrets. Cancelling is idempotent;
//    an already-dead token still answers ok.
//
// 2. Session-authenticated: "I saw the warning, I'm signed in" —
//    cancels every pending recovery for the account. The login flow
//    also invokes `cancelAllForEmail` implicitly.
export default defineEventHandler(async (event) => {
  const { recoveryStore } = useIdpStores()
  const body = await readBody<{ token?: string }>(event).catch(() => null)

  if (body?.token) {
    const recovery = await recoveryStore.find(body.token)
    const cancelled = recovery
      ? await recoveryStore.cancelAllForEmail(recovery.email, 'cancelled-by-warning-link')
      : 0
    return { ok: true, cancelled }
  }

  const session = await getAppSession(event)
  const userId = (session.data as { userId?: string }).userId
  if (!userId) {
    throw createProblemError({ status: 401, title: 'Authentication required' })
  }

  const cancelled = await recoveryStore.cancelAllForEmail(userId, 'cancelled-by-owner')
  return { ok: true, cancelled }
})
