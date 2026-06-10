import type { RecoveryToken } from '@openape/auth'
import { defineEventHandler } from 'h3'

// Recovery audit history for the account settings (#462).
//
// Owner-only read view: time, origin and outcome of every recovery attempt
// — the durable counterpart to volatile server logs. Never returns tokens
// or completion/cancel links, and deliberately has no mutating sibling
// route: history entries cannot be altered or deleted from the account UI.

type RecoveryOutcome = 'pending' | 'completed' | 'cancelled' | 'expired'

// "Expired" is derived, not stored: an attempt that was neither completed
// nor cancelled and whose hard expiry has passed simply lapsed unused.
function outcomeOf(token: RecoveryToken, now: number): RecoveryOutcome {
  if (token.consumed) return 'completed'
  if (token.cancelled) return 'cancelled'
  if (token.expiresAt < now) return 'expired'
  return 'pending'
}

export default defineEventHandler(async (event) => {
  // requireAuth + useIdpStores are auto-imported module utils.
  const email = await requireAuth(event)

  const { recoveryStore } = useIdpStores()
  const history = await recoveryStore.listAllForEmail(email)

  const now = Date.now()
  return history
    .map((token) => {
      const status = outcomeOf(token, now)
      return {
        requestedAt: token.createdAt,
        requestIp: token.requestIp,
        requestUserAgent: token.requestUserAgent,
        status,
        // A running attempt shows when it could complete.
        ...(status === 'pending' ? { usableAt: token.usableAt } : {}),
      }
    })
    .sort((a, b) => b.requestedAt - a.requestedAt)
})
