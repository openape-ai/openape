import type { MapView } from '../../contracts/map-view'

/**
 * The five system KPIs with the data their subtitles are made of. The words come from the
 * renderer's translations; nothing here is a judgement, only counts and names from the read model.
 */
export interface KpiFacts {
  active: number
  paused: { total: number, drafts: number, archived: number }
  degraded: { count: number, name: string | null, reason: string | null }
  /** Open owner questions, object approvals waiting at the IdP and runs waiting for a grant decision. */
  decisions: { count: number, questions: number, approvals: number }
  unknownDeliveries: number
}

export function kpiFacts(view: MapView): KpiFacts {
  const { kpis } = view
  const first = kpis.degraded[0]
  const runApprovals = view.pods.reduce((sum, pod) => sum + pod.approvals.length, 0)
  const total = (kind: 'question' | 'approval') => kpis.decisions.filter(item => item.kind === kind).reduce((sum, item) => sum + item.count, 0)
  return {
    active: kpis.active,
    paused: {
      total: kpis.paused,
      drafts: view.pods.filter(pod => pod.draft && pod.lifecycle !== 'archived').length,
      archived: view.pods.filter(pod => pod.lifecycle === 'archived').length,
    },
    degraded: { count: kpis.degraded.length, name: first ? view.pods.find(pod => pod.id === first.podId)?.name ?? null : null, reason: first?.reason ?? null },
    decisions: { count: total('question') + total('approval') + runApprovals, questions: total('question'), approvals: total('approval') + runApprovals },
    unknownDeliveries: kpis.unknownDeliveries,
  }
}
