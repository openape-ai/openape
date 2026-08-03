export interface WireEvent {
  id: string
  ts: number
  actor: string
  actor_kind: 'human' | 'agent'
  task_ref: string
  goal_ref?: string
  org_id?: string
  type: string
  payload: Record<string, unknown>
}

const REQUEST_TYPES = ['decision.requested', 'work.blocked', 'verdict.requested']
const RESOLUTION_TYPES = ['decision.made', 'verdict.given']

/**
 * Fold the event log into the open decision cards: request events without a
 * resolving event, longest-waiting first (the top card blocks the most).
 */
export function openRequests(events: WireEvent[]): WireEvent[] {
  const resolved = new Set(
    events
      .filter(e => RESOLUTION_TYPES.includes(e.type))
      .map(e => String(e.payload.request_id ?? '')),
  )
  return events
    .filter(e => REQUEST_TYPES.includes(e.type) && !resolved.has(e.id))
    .sort((a, b) => a.ts - b.ts)
}

/** Human card title per request type. */
export function cardTitle(event: WireEvent): string {
  if (event.type === 'verdict.requested') return `Verdict: ${event.task_ref}`
  return String(event.payload.question ?? event.task_ref)
}

/** "wartet 38 min" / "wartet 2 h" / "wartet 3 d" */
export function waitingLabel(event: WireEvent, nowSeconds: number): string {
  const seconds = Math.max(0, nowSeconds - event.ts)
  if (seconds < 3600) return `wartet ${Math.round(seconds / 60)} min`
  if (seconds < 86400) return `wartet ${Math.round(seconds / 3600)} h`
  return `wartet ${Math.round(seconds / 86400)} d`
}
