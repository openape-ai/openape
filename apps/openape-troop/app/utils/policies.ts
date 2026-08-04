import type { WireEvent } from './attention-inbox'

export interface Policy {
  id: string
  rule: string
  rationale?: string
  /** Where the rule is written down so it actually binds. */
  enforcedIn?: string
  /** The card this rule came out of — "since when, out of which decision". */
  sourceId?: string
  adopted: boolean
  ts: number
  actor: string
}

/**
 * Adopted rules first (they are in force), proposals after, each newest first.
 * A proposal whose rule text was later adopted disappears — the adopted one
 * supersedes it, and showing both would read as two competing rules.
 */
export function policiesFromEvents(events: WireEvent[]): Policy[] {
  const toPolicy = (e: WireEvent): Policy => ({
    id: e.id,
    rule: String(e.payload.rule ?? ''),
    rationale: e.payload.rationale as string | undefined,
    enforcedIn: e.payload.enforced_in as string | undefined,
    sourceId: e.payload.source_id as string | undefined,
    adopted: e.type === 'policy.adopted',
    ts: e.ts,
    actor: e.actor,
  })

  const adopted = events.filter(e => e.type === 'policy.adopted').map(toPolicy)
  const adoptedRules = new Set(adopted.map(p => p.rule))
  const proposed = events
    .filter(e => e.type === 'policy.proposed')
    .map(toPolicy)
    .filter(p => !adoptedRules.has(p.rule))

  const newestFirst = (a: Policy, b: Policy) => b.ts - a.ts
  return [...adopted.sort(newestFirst), ...proposed.sort(newestFirst)]
}
