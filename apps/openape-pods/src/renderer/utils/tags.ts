import type { MapTags, MapView } from '../../contracts/map-view'

const none: MapTags = { own: [], revision: 0 }
const named = (tags?: MapTags) => tags?.own ?? []

/** Tags of a Pod on the map. */
export function tagsOf(view: MapView, id: string): MapTags {
  return view.pods.find(pod => pod.id === id)?.tags ?? none
}

export function allTags(view: MapView): string[] {
  return [...new Set(view.pods.flatMap(item => named(item.tags)))].sort((a, b) => a.localeCompare(b, 'de'))
}

/** Selects the Pods without any tag; tags themselves never contain underscores. */
export const untagged = '_untagged'

/** Pods per tag plus `untagged` for Pods without any; archived Pods are not on the map. */
export function tagCounts(view: MapView): Map<string, number> {
  const counts = new Map<string, number>()
  for (const pod of view.pods.filter(pod => pod.lifecycle !== 'archived')) {
    const tags = named(pod.tags)
    for (const tag of tags.length ? tags : [untagged]) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return counts
}

/** The map reduced to the Pods that carry any selected tag, with the edges and systems they touch. */
export function withTags(view: MapView, selected: string[]): MapView {
  const wanted = new Set(selected)
  const matches = (tags?: MapTags) => named(tags).some(tag => wanted.has(tag)) || (wanted.has(untagged) && !named(tags).length)
  const kept = new Set(view.pods.filter(pod => matches(pod.tags)).map(pod => pod.id))
  const pods = new Set(view.pods.map(pod => pod.id))
  const edges = view.edges.filter(edge => [edge.from, edge.to].every(end => !pods.has(end) || kept.has(end)))
  const linked = new Set(edges.flatMap(edge => [edge.from, edge.to]))
  return {
    ...view,
    kpis: { ...view.kpis, degraded: view.kpis.degraded.filter(item => kept.has(item.podId)), decisions: view.kpis.decisions.filter(item => kept.has(item.podId)) },
    systems: view.systems.filter(system => linked.has(system.id)),
    pods: view.pods.filter(pod => kept.has(pod.id)),
    edges,
  }
}
