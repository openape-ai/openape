import type { MapApproval, MapGrant, MapPod, MapView } from '../../contracts/map-view'
import type { SecretRequestRow } from '../../contracts/secrets'

/**
 * The three system KPIs with the data their subtitles are made of. The words come from the
 * renderer's translations; nothing here is a judgement, only counts and names from the read model.
 */
export interface KpiFacts {
  /** Running Pods out of all Pods that are not archived; archived Pods have their own list. */
  active: { running: number, total: number }
  /**
   * Active Pods whose current state is an error; failures they already recovered from belong to their history.
   * `reason` is the settled run state.
   */
  errors: { podId: string, name: string, reason: string | null }[]
  decisions: DecisionCounts
}

const readableReasons = new Set(['failed', 'completedWithGaps'])

/**
 * What waits for the owner, per section of Entscheidungen. The KPI, the tab badge and the section counters all read
 * this one computation, so they never disagree.
 */
export interface DecisionCounts {
  count: number
  /** Object approvals requested at the IdP or uncertain after a restore. */
  approvals: number
  /** Runs waiting for a grant and grants the Pods requested at the IdP. */
  rights: number
  /** Failed work that no longer retries on its own. */
  secrets: number
}

/** One row of Entscheidungen → Rechte: a waiting run approval or a pending Pod grant. */
export type RightsRow
  = | { pod: MapPod, kind: 'approval', approval: MapApproval }
    | { pod: MapPod, kind: 'grant', grant: MapGrant }

export function rightsRows(view: MapView): RightsRow[] {
  return view.pods.flatMap(pod => [
    ...pod.approvals.map(approval => ({ pod, kind: 'approval' as const, approval })),
    ...(pod.grants ?? []).map(grant => ({ pod, kind: 'grant' as const, grant })),
  ])
}

/** Secret requests the owner still has to fill or cancel. */
export const openSecretRequests = (requests: SecretRequestRow[]) => requests.filter(row => row.status !== 'collected' && row.status !== 'expired')

export function decisionCounts(view: MapView, requests: SecretRequestRow[] = []): DecisionCounts {
  const total = (kind: 'question' | 'approval') => view.kpis.decisions.filter(item => item.kind === kind).reduce((sum, item) => sum + item.count, 0)
  const counts = {
    approvals: total('approval'),
    rights: rightsRows(view).length,
    secrets: openSecretRequests(requests).length,
  }
  return { count: Object.values(counts).reduce((sum, value) => sum + value, 0), ...counts }
}

export function kpiFacts(view: MapView, requests: SecretRequestRow[] = []): KpiFacts {
  const { kpis } = view
  // Same rule as the row state: a paused or archived Pod shows as paused, not failing.
  const errors = kpis.degraded.flatMap((item) => {
    const pod = view.pods.find(candidate => candidate.id === item.podId)
    return pod?.lifecycle === 'active' ? [{ podId: pod.id, name: pod.name, reason: readableReasons.has(item.reason) ? item.reason : null }] : []
  })
  return {
    active: { running: kpis.active, total: view.pods.filter(pod => pod.lifecycle !== 'archived').length },
    errors,
    decisions: decisionCounts(view, requests),
  }
}
