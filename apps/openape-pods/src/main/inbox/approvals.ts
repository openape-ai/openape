import type { InboxApprovals } from '../../contracts/inbox'
import type { ApesLogin } from '../connections/apes-login'
import { readJSON } from '../connections/http'

// One IdP read per minute at most; the inbox publishes every ten seconds.
const cacheMs = 60000

/**
 * Counts what `apes grants inbox` lists: pending grants that others requested from the owner.
 * A batch is one approval on the IdP page, so its members count once.
 */
export function countPendingGrants(page: unknown, account: string, nowSec = Math.floor(Date.now() / 1000)): number {
  const data = (page as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) throw new Error('Invalid IdP grant listing')
  const own = account.trim().toLowerCase()
  const approvals = new Set<string>()
  for (const grant of data as { id?: unknown, status?: unknown, requester?: unknown, request?: { requester?: unknown, waits_until?: unknown, batch?: { id?: unknown } } }[]) {
    const requester = grant.request?.requester ?? grant.requester
    if (grant.status !== 'pending' || typeof grant.id !== 'string' || typeof requester !== 'string' || requester.toLowerCase() === own) continue
    // Nobody waits for a request past its waits_until (grants.md isCallerWaiting); a decision would have no effect.
    if (typeof grant.request?.waits_until === 'number' && grant.request.waits_until <= nowSec) continue
    const batch = grant.request?.batch?.id
    approvals.add(typeof batch === 'string' ? `batch:${requester}:${batch}` : `grant:${grant.id}`)
  }
  return approvals.size
}

/**
 * The grants waiting for the owner at the IdP, read with the owner's apes login (read only, like `apes grants inbox`).
 * Without a usable login of this owner the count is unknown, never zero.
 */
export function pendingApprovals(login: () => ApesLogin, account: () => Promise<{ issuer: string, email: string }>) {
  let cached: { at: number, value: InboxApprovals } | null = null
  return async (signal: AbortSignal): Promise<InboxApprovals> => {
    if (cached && Date.now() - cached.at < cacheMs) return cached.value
    const owner = await account()
    const url = `${owner.issuer}/grants`
    let pending: number | null = null
    try {
      const token = login().signedIn(owner.issuer, owner.email) ? await login().token(signal) : null
      if (token) {
        // ponytail: one page of 100 grants; a longer backlog shows as 100 until it shrinks.
        const reply = await fetch(`${token.issuer}/api/grants?status=pending&limit=100`, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), headers: { Authorization: `Bearer ${token.accessToken}` } })
        pending = countPendingGrants(await readJSON(reply), owner.email)
      }
    }
    catch (error) { console.error('Could not count pending IdP approvals', error) }
    cached = { at: Date.now(), value: { pending, url } }
    return cached.value
  }
}
