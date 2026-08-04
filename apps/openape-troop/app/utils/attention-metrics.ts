import type { WireEvent } from './attention-inbox'

const REQUEST_TYPES = ['call.raised', 'decision.requested', 'work.blocked', 'verdict.requested']
const RESOLUTION_TYPES = ['call.answered', 'decision.made', 'verdict.given']

export interface Metrics {
  /** How long the machine waits for a human, in seconds. The scarce resource. */
  medianWaitSeconds: number | null
  /** Share of finished work that never had to interrupt the human. */
  autonomyRate: number | null
  /** Share of verdicts that sent the work back. A proxy for spec quality. */
  reworkRate: number | null
  answered: number
  openNow: number
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!
}

/** Pair each request with the event that resolved it (by `request_id`). */
function pairs(events: WireEvent[]): Array<{ request: WireEvent, resolution: WireEvent }> {
  const byRequestId = new Map<string, WireEvent>()
  for (const event of events) {
    if (!RESOLUTION_TYPES.includes(event.type)) continue
    const requestId = event.payload.request_id as string | undefined
    // First resolution wins — the 409 guard makes a second one impossible,
    // but a replayed log should not change the numbers either.
    if (requestId && !byRequestId.has(requestId)) byRequestId.set(requestId, event)
  }
  return events
    .filter(e => REQUEST_TYPES.includes(e.type) && byRequestId.has(e.id))
    .map(request => ({ request, resolution: byRequestId.get(request.id)! }))
}

/**
 * The three numbers the inbox shows. They measure the human, not the machine:
 * how long agents wait, how often they had to ask, how often the answer was
 * "do it again". Auto-applied timeout resolutions are excluded from the wait
 * time — nobody waited for those, they expired.
 */
export function metricsFromEvents(events: WireEvent[]): Metrics {
  const resolved = pairs(events)

  const waits = resolved
    .filter(({ resolution }) => resolution.payload.auto !== true)
    .map(({ request, resolution }) => Math.max(0, resolution.ts - request.ts))

  const verdicts = events.filter(e =>
    e.type === 'verdict.given' || (e.type === 'call.answered' && ['merge', 'rework', 'reject'].includes(String(e.payload.answer))),
  )
  const reworks = verdicts.filter(e => (e.payload.verdict ?? e.payload.answer) === 'rework')

  // A task is autonomous when it shipped without ever blocking on a human
  // question. Verdicts do not count — reviewing is the point, interrupting is not.
  const shippedTasks = new Set(events.filter(e => e.type === 'task.shipped').map(e => e.task_ref))
  const blockedTasks = new Set(
    events
      .filter(e => e.type === 'work.blocked' || e.type === 'decision.requested'
        || (e.type === 'call.raised' && e.payload.kind !== 'verdict'))
      .map(e => e.task_ref),
  )
  const autonomous = [...shippedTasks].filter(ref => !blockedTasks.has(ref))

  const resolvedIds = new Set(resolved.map(({ request }) => request.id))
  const openNow = events.filter(e => REQUEST_TYPES.includes(e.type) && !resolvedIds.has(e.id)).length

  return {
    medianWaitSeconds: median(waits),
    autonomyRate: shippedTasks.size === 0 ? null : autonomous.length / shippedTasks.size,
    reworkRate: verdicts.length === 0 ? null : reworks.length / verdicts.length,
    answered: resolved.length,
    openNow,
  }
}

export interface AgentRecord {
  agent: string
  reviews: number
  merged: number
  reworked: number
  /** Share of reviews that went through without rework. */
  cleanRate: number
  /** Suggested — never enforced. See suggestedSampling(). */
  suggestedSampling: number
}

/**
 * How much of an agent's work a human should still look at. Deliberately
 * conservative: below 20 reviews there is no track record worth trusting, so
 * everything is sampled. This is a suggestion the UI shows — nothing in the
 * system acts on it.
 */
export function suggestedSampling(reviews: number, cleanRate: number): number {
  if (reviews < 20) return 1
  if (cleanRate >= 0.95) return 0.1
  if (cleanRate >= 0.9) return 0.25
  if (cleanRate >= 0.8) return 0.5
  return 1
}

/** Per-agent review history, busiest first. */
export function agentRecords(events: WireEvent[]): AgentRecord[] {
  const requests = new Map<string, string>()
  for (const event of events) {
    const isVerdictCall = event.type === 'verdict.requested'
      || (event.type === 'call.raised' && event.payload.kind === 'verdict')
    if (isVerdictCall) requests.set(event.id, event.actor)
  }

  const counts = new Map<string, { reviews: number, merged: number, reworked: number }>()
  for (const event of events) {
    if (event.type !== 'verdict.given' && event.type !== 'call.answered') continue
    const requestId = event.payload.request_id as string | undefined
    const agent = requestId ? requests.get(requestId) : undefined
    if (!agent) continue
    const entry = counts.get(agent) ?? { reviews: 0, merged: 0, reworked: 0 }
    entry.reviews++
    const verdict = event.payload.verdict ?? event.payload.answer
    if (verdict === 'merge') entry.merged++
    if (verdict === 'rework') entry.reworked++
    counts.set(agent, entry)
  }

  return Array.from(counts.entries(), ([agent, c]) => {
    const cleanRate = c.reviews === 0 ? 0 : (c.reviews - c.reworked) / c.reviews
    return { agent, ...c, cleanRate, suggestedSampling: suggestedSampling(c.reviews, cleanRate) }
  })
    .sort((a, b) => b.reviews - a.reviews)
}
