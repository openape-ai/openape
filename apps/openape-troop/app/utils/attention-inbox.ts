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

// A call is a decision waiting on a human. `call.raised`/`call.answered` is the
// current vocabulary; the three older request types stay folded in because the
// log already holds 50+ of them.
const REQUEST_TYPES = ['call.raised', 'decision.requested', 'work.blocked', 'verdict.requested']
const RESOLUTION_TYPES = ['call.answered', 'decision.made', 'verdict.given']

/** decision | escalation | verdict — from the payload for a call, from the type otherwise. */
export function callKind(event: WireEvent): 'decision' | 'escalation' | 'verdict' {
  if (event.type === 'call.raised') return (event.payload.kind as 'decision' | 'escalation' | 'verdict') ?? 'decision'
  if (event.type === 'verdict.requested') return 'verdict'
  if (event.type === 'work.blocked') return 'escalation'
  return 'decision'
}

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

/**
 * A message for the UI to render: the i18n key plus its params. These folds
 * stay pure functions — the component calls `t()` on what they return, so
 * they remain unit-testable without a Vue context.
 */
export interface Translatable {
  key: string
  params: Record<string, string | number>
}

/**
 * Human card title: the author's headline if there is one, else the question.
 * Both are text the agent wrote, so they travel through `cardTitle.plain`
 * ("{text}") and reach the screen verbatim — the caller renders one t() call
 * either way.
 */
export function cardTitle(event: WireEvent): Translatable {
  const title = event.payload.title as string | undefined
  if (title) return { key: 'inbox.cardTitle.plain', params: { text: title } }
  if (callKind(event) === 'verdict') return { key: 'inbox.cardTitle.verdict', params: { ref: event.task_ref } }
  return { key: 'inbox.cardTitle.plain', params: { text: String(event.payload.question ?? event.task_ref) } }
}

/** How long the call has waited — "wartet 38 min" / "wartet 2 h" / "wartet 3 d". */
export function waitingLabel(event: WireEvent, nowSeconds: number): Translatable {
  const seconds = Math.max(0, nowSeconds - event.ts)
  if (seconds < 3600) return { key: 'inbox.waitingFor.minutes', params: { count: Math.round(seconds / 60) } }
  if (seconds < 86400) return { key: 'inbox.waitingFor.hours', params: { count: Math.round(seconds / 3600) } }
  return { key: 'inbox.waitingFor.days', params: { count: Math.round(seconds / 86400) } }
}
