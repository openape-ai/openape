import type { H3Event } from 'h3'
import { randomBytes } from 'node:crypto'

// Attention events (plan 01KZ3QPW5EC0JRXN5TB60R54TQ) let troop's inbox show
// "this PR is waiting for your verdict" without pr.openape.ai knowing anything
// about inboxes. Emission is best-effort: a troop outage must never fail a PR
// upload, so failures are logged loudly and swallowed.
//
// Identity: we forward the caller's own Bearer, so the event is attributed to
// the agent that pushed the PR. Session-cookie callers carry no bearer troop
// would accept — those emissions are skipped (the human path resolves in troop
// itself, where the reviewer is already authenticated).

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function ulidLike(nowMs = Date.now()): string {
  let time = ''
  for (let i = 0, t = nowMs; i < 10; i++, t = Math.floor(t / 32)) {
    time = CROCKFORD[t % 32] + time
  }
  let rand = ''
  for (let bits = BigInt(`0x${randomBytes(10).toString('hex')}`), i = 0; i < 16; i++, bits >>= 5n) {
    rand = CROCKFORD[Number(bits & 31n)] + rand
  }
  return time + rand
}

export interface EmitContext {
  actor: string
  actorKind: 'human' | 'agent'
  taskRef: string
  reviewUrl: string
}

/** The events a fresh PR raises: a verdict card plus the PR as its proof. */
export function verdictRequestedEvents(ctx: EmitContext, nowSeconds: number) {
  const envelope = {
    ts: nowSeconds,
    actor: ctx.actor,
    actor_kind: ctx.actorKind,
    task_ref: ctx.taskRef,
  }
  return [
    { id: ulidLike(), ...envelope, type: 'verdict.requested', payload: { pr_url: ctx.reviewUrl } },
    { id: ulidLike(), ...envelope, type: 'proof.attached', payload: { url: ctx.reviewUrl, kind: 'pr' } },
  ]
}

/**
 * POST the events to troop under the caller's bearer. Never throws: returns
 * the number of accepted events (0 when disabled, unauthenticated, or failing).
 */
export async function emitToTroop(event: H3Event, events: Array<Record<string, unknown>>): Promise<number> {
  const troopUrl = useRuntimeConfig().troopUrl as string
  if (!troopUrl) return 0

  const auth = getHeader(event, 'Authorization')
  if (!auth?.toLowerCase().startsWith('bearer ')) return 0

  let accepted = 0
  for (const body of events) {
    try {
      await $fetch(`${troopUrl}/api/events`, { method: 'POST', body, headers: { Authorization: auth } })
      accepted++
    }
    catch (err) {
      console.error('[pr/attention] emit failed:', (err as { statusCode?: number }).statusCode ?? '', String(err))
    }
  }
  return accepted
}
