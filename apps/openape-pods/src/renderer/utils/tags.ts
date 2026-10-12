import type { MapTags, MapView } from '../../contracts/map-view'

const none: MapTags = { own: [], inherited: [], revision: 0 }
const named = (tags?: MapTags) => tags ? [...tags.own, ...tags.inherited] : []

/** Tags of a Pod or network on the map; a network member also shows its network's tags as inherited. */
export function tagsOf(view: MapView, id: string): MapTags {
  return view.pods.find(pod => pod.id === id)?.tags ?? view.automations.find(automation => automation.id === id)?.tags ?? none
}

export function allTags(view: MapView): string[] {
  return [...new Set([...view.pods, ...view.automations].flatMap(item => named(item.tags)))].sort((a, b) => a.localeCompare(b, 'de'))
}

/** Selects the Pods without any tag; tags themselves never contain underscores. */
export const untagged = '_untagged'

/** Pods per tag, own or inherited, plus `untagged` for Pods without any; archived Pods are not on the map. */
export function tagCounts(view: MapView): Map<string, number> {
  const counts = new Map<string, number>()
  for (const pod of view.pods.filter(pod => pod.lifecycle !== 'archived')) {
    const tags = named(pod.tags)
    for (const tag of tags.length ? tags : [untagged]) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return counts
}

/** The map reduced to what carries any selected tag, own or inherited; a tagged network keeps all its members. */
export function withTags(view: MapView, selected: string[]): MapView {
  const wanted = new Set(selected)
  const matches = (tags?: MapTags) => named(tags).some(tag => wanted.has(tag)) || (wanted.has(untagged) && !named(tags).length)
  const kept = new Set(view.pods.filter(pod => matches(pod.tags)).map(pod => pod.id))
  for (const automation of view.automations) {
    if (named(automation.tags).some(tag => wanted.has(tag))) automation.members.forEach(id => kept.add(id))
  }
  const automations = view.automations.filter(automation => automation.members.some(id => kept.has(id))).map(automation => ({ ...automation, members: automation.members.filter(id => kept.has(id)) }))
  const pods = new Set(view.pods.map(pod => pod.id))
  const edges = view.edges.filter(edge => [edge.from, edge.to].every(end => !pods.has(end) || kept.has(end)))
  const linked = new Set(edges.flatMap(edge => [edge.from, edge.to]))
  const networks = new Set(automations.map(automation => automation.id))
  return {
    ...view,
    kpis: { ...view.kpis, degraded: view.kpis.degraded.filter(item => kept.has(item.podId)), decisions: view.kpis.decisions.filter(item => networks.has(item.networkId)) },
    systems: view.systems.filter(system => linked.has(system.id)),
    pods: view.pods.filter(pod => kept.has(pod.id)),
    automations,
    edges,
  }
}
