import type { MapTags, MapView } from '../../contracts/map-view'

const none: MapTags = { own: [], inherited: [], revision: 0 }

/** Tags of a Pod or network on the map; a network member also shows its network's tags as inherited. */
export function tagsOf(view: MapView, id: string): MapTags {
  return view.pods.find(pod => pod.id === id)?.tags ?? view.automations.find(automation => automation.id === id)?.tags ?? none
}

export function allTags(view: MapView): string[] {
  const items = [...view.pods, ...view.automations].map(item => item.tags ?? none)
  return [...new Set(items.flatMap(tags => [...tags.own, ...tags.inherited]))].sort((a, b) => a.localeCompare(b, 'de'))
}

/** The map reduced to what carries `tag`, own or inherited; a tagged network keeps all its members. */
export function withTag(view: MapView, tag: string | null): MapView {
  if (!tag) return view
  const has = (tags?: MapTags) => !!tags && (tags.own.includes(tag) || tags.inherited.includes(tag))
  const kept = new Set(view.pods.filter(pod => has(pod.tags)).map(pod => pod.id))
  for (const automation of view.automations) {
    if (has(automation.tags)) automation.members.forEach(id => kept.add(id))
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
