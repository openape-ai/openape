import type { MapView } from '../../contracts/map-view'

/**
 * The five system KPIs with the data their subtitles are made of. The words come from the
 * renderer's translations; nothing here is a judgement, only counts and names from the read model.
 */
export interface KpiFacts {
  active: number
  paused: { total: number, networks: number, drafts: number, archived: number }
  degraded: { count: number, name: string | null, reason: string | null }
  /** Open route decisions of networks and runs waiting for an approval at the IdP. */
  decisions: { count: number, gates: { title: string, group: string | null }[], approvals: number }
  unknownDeliveries: number
}

export function kpiFacts(view: MapView): KpiFacts {
  const { kpis } = view
  const standalone = view.pods.filter(pod => !pod.automation)
  const first = kpis.degraded[0]
  const approvals = view.pods.reduce((sum, pod) => sum + pod.approvals.length, 0)
  return {
    active: kpis.active,
    paused: {
      total: kpis.paused,
      networks: view.automations.filter(automation => automation.kind === 'network' && automation.state !== 'active').length,
      drafts: standalone.filter(pod => pod.draft && pod.lifecycle !== 'archived').length,
      archived: standalone.filter(pod => pod.lifecycle === 'archived').length,
    },
    degraded: { count: kpis.degraded.length, name: first ? view.pods.find(pod => pod.id === first.podId)?.name ?? null : null, reason: first?.reason ?? null },
    decisions: {
      count: kpis.decisions.reduce((sum, item) => sum + item.count, 0) + approvals,
      approvals,
      gates: kpis.decisions.map(item => ({ title: item.title, group: view.automations.find(automation => automation.id === item.networkId)?.group ?? null })),
    },
    unknownDeliveries: kpis.unknownDeliveries,
  }
}
