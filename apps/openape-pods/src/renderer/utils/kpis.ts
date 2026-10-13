import type { MapApproval, MapGrant, MapPod, MapView } from '../../contracts/map-view'
import type { SecretRequestRow } from '../../contracts/secrets'

/**
 * The five system KPIs with the data their subtitles are made of. The words come from the
 * renderer's translations; nothing here is a judgement, only counts and names from the read model.
 */
export interface KpiFacts {
  active: number
  paused: { total: number, drafts: number, archived: number }
  degraded: { count: number, name: string | null, reason: string | null }
  /** Failed, interrupted and blocked runs of the last 24 hours, with the Pods that had them, most first. */
  failures: { runs: number, pods: { name: string, count: number }[] }
  decisions: DecisionCounts
  unknownDeliveries: number
}

/**
 * What waits for the owner, per section of Entscheidungen. The KPI, the tab badge and the section counters all read
 * this one computation, so they never disagree.
 */
export interface DecisionCounts {
  count: number
  questions: number
  /** Object approvals requested at the IdP or uncertain after a restore. */
  approvals: number
  /** Runs waiting for a grant, grants the Pods requested at the IdP and blocked event queues. */
  rights: number
  /** Held work and deliveries or actions whose outcome is unknown. */
  reconcile: number
  secrets: number
}

/** One row of Entscheidungen → Rechte: a waiting run approval, a pending Pod grant or a blocked queue. */
export type RightsRow
  = | { pod: MapPod, kind: 'approval', approval: MapApproval }
    | { pod: MapPod, kind: 'grant', grant: MapGrant }
    | { pod: MapPod, kind: 'blocked', error: string | null }

export function rightsRows(view: MapView): RightsRow[] {
  return view.pods.flatMap((pod) => {
    const grants = pod.grants ?? []
    return [
      ...pod.approvals.map(approval => ({ pod, kind: 'approval' as const, approval })),
      ...grants.map(grant => ({ pod, kind: 'grant' as const, grant })),
      ...(pod.queue.blocked && !pod.approvals.length && !grants.length ? [{ pod, kind: 'blocked' as const, error: pod.queue.error }] : []),
    ]
  })
}

/** Secret requests the owner still has to fill or cancel. */
export const openSecretRequests = (requests: SecretRequestRow[]) => requests.filter(row => row.status !== 'collected' && row.status !== 'expired')

export function decisionCounts(view: MapView, requests: SecretRequestRow[] = []): DecisionCounts {
  const total = (kind: 'question' | 'approval') => view.kpis.decisions.filter(item => item.kind === kind).reduce((sum, item) => sum + item.count, 0)
  const counts = {
    questions: total('question'),
    approvals: total('approval'),
    rights: rightsRows(view).length,
    reconcile: view.pods.reduce((sum, pod) => sum + pod.work.held, 0) + view.kpis.unknownDeliveries,
    secrets: openSecretRequests(requests).length,
  }
  return { count: Object.values(counts).reduce((sum, value) => sum + value, 0), ...counts }
}

export function kpiFacts(view: MapView, requests: SecretRequestRow[] = []): KpiFacts {
  const { kpis } = view
  const first = kpis.degraded[0]
  const failing = view.pods.filter(pod => (pod.failures ?? 0) > 0).map(pod => ({ name: pod.name, count: pod.failures! })).sort((a, b) => b.count - a.count)
  return {
    active: kpis.active,
    paused: {
      total: kpis.paused,
      drafts: view.pods.filter(pod => pod.draft && pod.lifecycle !== 'archived').length,
      archived: view.pods.filter(pod => pod.lifecycle === 'archived').length,
    },
    degraded: { count: kpis.degraded.length, name: first ? view.pods.find(pod => pod.id === first.podId)?.name ?? null : null, reason: first?.reason ?? null },
    failures: { runs: failing.reduce((sum, pod) => sum + pod.count, 0), pods: failing },
    decisions: decisionCounts(view, requests),
    unknownDeliveries: kpis.unknownDeliveries,
  }
}
