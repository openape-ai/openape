import type { MapView } from '../../contracts/map-view'

/**
 * The five system KPIs with the data their subtitles are made of. The words come from the
 * renderer's translations; nothing here is a judgement, only counts and names from the read model.
 */
export interface KpiFacts {
  active: number
  paused: { total: number, networks: number, drafts: number, archived: number }
  degraded: { count: number, name: string | null, reason: string | null }
  decisions: { count: number, gates: { title: string, group: string | null }[] }
  unknownDeliveries: number
}

export function kpiFacts(view: MapView): KpiFacts {
  const { kpis } = view
  const standalone = view.pods.filter(pod => !pod.collection)
  const first = kpis.degraded[0]
  return {
    active: kpis.active,
    paused: {
      total: kpis.paused,
      networks: view.collections.filter(collection => collection.kind === 'network' && collection.state !== 'active').length,
      drafts: standalone.filter(pod => pod.draft && pod.lifecycle !== 'archived').length,
      archived: standalone.filter(pod => pod.lifecycle === 'archived').length,
    },
    degraded: { count: kpis.degraded.length, name: first ? view.pods.find(pod => pod.id === first.podId)?.name ?? null : null, reason: first?.reason ?? null },
    decisions: {
      count: kpis.decisions.reduce((sum, item) => sum + item.count, 0),
      gates: kpis.decisions.map(item => ({ title: item.title, group: view.collections.find(collection => collection.id === item.networkId)?.group ?? null })),
    },
    unknownDeliveries: kpis.unknownDeliveries,
  }
}
