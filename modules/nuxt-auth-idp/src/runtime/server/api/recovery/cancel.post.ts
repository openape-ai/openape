import { defineEventHandler } from 'h3'
import { getAppSession } from '../../utils/session'
import { useIdpStores } from '../../utils/stores'
import { createProblemError } from '../../utils/problem'

// Cancel every pending recovery for the authenticated user (#297).
//
// This is the active-owner veto: any user who can still authenticate
// from any existing device cancels every pending recovery. We also
// invoke `cancelAllForEmail` implicitly from the login flow, so this
// explicit endpoint is for the "I saw the warning mail/push, click to
// cancel" path that doesn't require a full login.
export default defineEventHandler(async (event) => {
  const session = await getAppSession(event)
  const userId = (session.data as { userId?: string }).userId
  if (!userId) {
    throw createProblemError({ status: 401, title: 'Authentication required' })
  }

  const { recoveryStore } = useIdpStores()
  const cancelled = await recoveryStore.cancelAllForEmail(userId, 'cancelled-by-owner')

  return { ok: true, cancelled }
})
