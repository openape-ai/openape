import type { ScheduleSpec } from './scheduling'

/**
 * The read model behind the Automatisierungen surface: every Pod and network of the owner
 * with the systems they read and write, measured flows of the last 24 hours and the five system
 * KPIs. Derived in the worker from existing tables, never stored; desktop, browser and MCP read
 * the same JSON. Secrets appear as aliases only.
 */
export type MapPodKind = 'source' | 'decision' | 'effect' | 'code'
export type MapSystemKind = 'service' | 'application' | 'directory' | 'ssh'
export type MapResourceKind = MapSystemKind | 'secret' | 'reference'
export interface MapSystem { id: string, kind: MapSystemKind, name: string, how: string }
export interface MapResource { kind: MapResourceKind, name: string, how: string, system: string | null }
export interface MapRun { at: number, state: string, summary: string }
export interface MapSchedule { spec: ScheduleSpec | null, enabled: boolean }
export interface MapApproval { grantId: string, title: string, runId: string }
export interface MapPod {
  id: string
  name: string
  revision: number
  script: string | null
  description: string | null
  group: string | null
  groupId: string | null
  lifecycle: 'active' | 'paused' | 'archived'
  draft: boolean
  kind: MapPodKind
  ai: boolean
  channels: { takes: string[], gives: string[] }
  resources: MapResource[]
  secrets: string[]
  schedule: MapSchedule | null
  lastRun: MapRun | null
  runs: number
  automation: string | null
  queue: { blocked: number, error: string | null }
  approvals: MapApproval[]
  unknown: { key: string, runId: string }[]
  // Latest script update of a network member through the local assistant, while that version is active.
  scriptUpdate?: { at: number, previous: string, script: string }
}
export interface MapGateOption { key: string, title: string, channel: string }
export interface MapGate { key: string, kind: 'choose' | 'approve', title: string, takes: string, options: MapGateOption[], open: number, batches: Record<string, number> }
export interface MapAutomation {
  id: string
  revision: number
  kind: 'network'
  name: string
  group: string | null
  groupId: string | null
  state: 'active' | 'paused' | 'archived'
  members: string[]
  schedule: MapSchedule | null
  counts: Record<string, number>
  flows: Record<string, number>
  gates: MapGate[]
  lastRun: MapRun | null
}
export interface MapEdge { from: string, to: string, type: 'read' | 'write' | 'channel', channel: string | null, flow: number }
export interface MapKpis {
  active: number
  paused: number
  degraded: { podId: string, reason: string }[]
  decisions: { networkId: string, gate: string, title: string, kind: 'choose' | 'approve', count: number }[]
  unknownDeliveries: number
}
export interface MapView { at: number, window: { from: number, to: number }, kpis: MapKpis, systems: MapSystem[], pods: MapPod[], automations: MapAutomation[], edges: MapEdge[] }

export const mapLimits = { pods: 100, automations: 64, systems: 400, edges: 4000 } as const
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid map view')
  return value as Record<string, unknown>
}
function list(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error('Invalid map view list')
  return value
}
function integer(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('Invalid map view number')
  return value as number
}
function text(value: unknown, maximum = 4096): string {
  if (typeof value !== 'string' || value.length > maximum || value.includes('\0')) throw new Error('Invalid map view text')
  return value
}

// Desktops before issue 1455 (M5) publish automations as `collections` and each Pod's as `collection`; the relay reads both until those builds are replaced.
function currentNames(view: Record<string, unknown>): Record<string, unknown> {
  if (!Object.hasOwn(view, 'collections')) return view
  const { collections, pods, ...rest } = view
  return { ...rest, automations: collections, pods: list(pods, mapLimits.pods).map((pod) => { const { collection, ...fields } = object(pod); return { ...fields, automation: collection ?? null } }) }
}

// Desktops before issue 1455 (M4) also publish workflows as chains and bounded networks; the relay shows persistent networks only.
function networksOnly(view: Record<string, unknown>): Record<string, unknown> {
  const automations = list(view.automations, mapLimits.automations).map(object)
  const retired = new Set(automations.filter(item => item.kind !== 'network' || item.bounded === true).map(item => item.id))
  if (!retired.size && !automations.some(item => Object.hasOwn(item, 'bounded'))) return view
  const kept = automations.filter(item => !retired.has(item.id)).map(({ bounded: _bounded, ...item }) => item)
  const gates = new Set(kept.flatMap(item => list(item.gates, 32).map(gate => `gate:${String(object(gate).key)}`)))
  const retiredGate = (node: unknown) => typeof node === 'string' && node.startsWith('gate:') && !gates.has(node)
  return {
    ...view,
    automations: kept,
    pods: list(view.pods, mapLimits.pods).map((pod) => { const item = object(pod); return retired.has(item.automation) ? { ...item, automation: null } : item }),
    edges: list(view.edges, mapLimits.edges).map(object).filter(edge => !retiredGate(edge.from) && !retiredGate(edge.to)),
  }
}

/** Shape check for what crosses the relay and MCP; the content stays the worker's. */
export function parseMapView(value: unknown): MapView {
  const view = networksOnly(currentNames(object(value)))
  if (Object.keys(view).some(key => !['at', 'window', 'kpis', 'systems', 'pods', 'automations', 'edges'].includes(key))) throw new Error('Invalid map view fields')
  integer(view.at); const window = object(view.window); integer(window.from); integer(window.to)
  const kpis = object(view.kpis); integer(kpis.active); integer(kpis.paused); integer(kpis.unknownDeliveries)
  for (const item of list(kpis.degraded, mapLimits.pods)) { const row = object(item); text(row.podId, 36); text(row.reason) }
  for (const item of list(kpis.decisions, 512)) { const row = object(item); text(row.networkId, 36); text(row.gate, 64); text(row.title, 120); integer(row.count) }
  const systems = new Set<string>()
  for (const item of list(view.systems, mapLimits.systems)) {
    const row = object(item); const id = text(row.id, 4200); text(row.name); text(row.how)
    if (!['service', 'application', 'directory', 'ssh'].includes(String(row.kind)) || systems.has(id)) throw new Error('Invalid map system')
    systems.add(id)
  }
  const nodes = new Set(systems)
  for (const item of list(view.pods, mapLimits.pods)) {
    const pod = object(item); const id = text(pod.id, 36); text(pod.name, 200)
    if (!['active', 'paused', 'archived'].includes(String(pod.lifecycle)) || !['source', 'decision', 'effect', 'code'].includes(String(pod.kind)) || typeof pod.ai !== 'boolean') throw new Error('Invalid map pod')
    for (const resource of list(pod.resources, 256)) {
      const row = object(resource); text(row.name); text(row.how)
      if (!['service', 'application', 'directory', 'ssh', 'secret', 'reference'].includes(String(row.kind)) || (row.system !== null && !systems.has(text(row.system, 4200)))) throw new Error('Invalid map resource')
    }
    for (const alias of list(pod.secrets, 64)) text(alias, 200)
    if (pod.scriptUpdate !== undefined) {
      const update = object(pod.scriptUpdate); integer(update.at)
      if ([update.previous, update.script].some(hash => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) throw new Error('Invalid map script update')
    }
    nodes.add(id)
  }
  for (const item of list(view.automations, mapLimits.automations)) {
    const automation = object(item); const id = text(automation.id, 36); text(automation.name, 200)
    if (automation.kind !== 'network' || !['active', 'paused', 'archived'].includes(String(automation.state))) throw new Error('Invalid map automation')
    for (const member of list(automation.members, 64)) { if (!nodes.has(text(member, 36))) throw new Error('Invalid map automation member') }
    for (const gate of list(automation.gates, 32)) { const row = object(gate); text(row.key, 64); text(row.title, 120); integer(row.open); nodes.add(`gate:${text(row.key, 64)}`) }
    nodes.add(id)
  }
  for (const item of list(view.edges, mapLimits.edges)) {
    const edge = object(item); integer(edge.flow)
    if (!['read', 'write', 'channel'].includes(String(edge.type)) || !nodes.has(text(edge.from, 4200)) || !nodes.has(text(edge.to, 4200))) throw new Error('Invalid map edge')
  }
  return structuredClone(view) as unknown as MapView
}
