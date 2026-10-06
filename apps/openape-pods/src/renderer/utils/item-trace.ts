import type { GraphNodeKind, GraphTraceEvent } from '../../contracts/graphs'

export interface TraceRow { node: string, name: string, kind: GraphNodeKind, outcome: string, text: string, detail: string, open: boolean }
const sentences: Record<string, string> = {
  emitted: 'Handed on',
  consumed: 'Processed',
  held: 'Waits for your decision',
  approved: 'Approved by you',
  excluded: 'Excluded by you',
  chosen: 'Chosen by you',
  refused: 'Refused',
  expired: 'Approval expired',
  changed: 'Changed since the approval',
  failed: 'Run failed; will be retried',
}
export const outcomeText = (outcome: string): string => sentences[outcome] ?? outcome

/**
 * One row per step. The reason of a step is mail or model text and is shown as it is, never
 * interpreted. A row is open while the item still waits at that node.
 */
export function traceRows(events: GraphTraceEvent[], names: Record<string, string>, kinds: Record<string, GraphNodeKind>): TraceRow[] {
  return events.map((event, index) => ({
    node: event.node,
    name: names[event.node] ?? event.node,
    kind: kinds[event.node] ?? 'code',
    outcome: event.outcome,
    text: event.reason ?? '',
    detail: event.confidence === null ? event.channel ?? '' : `${Math.round(event.confidence * 100)} %`,
    open: event.outcome === 'held' && !events.slice(index + 1).some(later => later.node === event.node),
  }))
}
