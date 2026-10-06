import type { ScheduleSpec } from './scheduling'
import type { WorkflowSchedule } from './workflows'

/**
 * The read model behind the Automatisierungen surface: every Pod, chain and network of the owner
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
export interface MapSchedule { spec: ScheduleSpec | WorkflowSchedule | null, enabled: boolean }
export interface MapApproval { grantId: string, title: string }
export interface MapPod {
  id: string
  name: string
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
  collection: string | null
  queue: { blocked: number, error: string | null }
  approvals: MapApproval[]
}
export interface MapGateOption { key: string, title: string, channel: string }
export interface MapGate { key: string, kind: 'choose' | 'approve', title: string, takes: string, options: MapGateOption[], open: number, batches: Record<string, number> }
export interface MapCollection {
  id: string
  kind: 'network' | 'chain'
  bounded: boolean
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
export interface MapView { at: number, window: { from: number, to: number }, kpis: MapKpis, systems: MapSystem[], pods: MapPod[], collections: MapCollection[], edges: MapEdge[] }

export const mapLimits = { pods: 100, collections: 64, systems: 400, edges: 4000 } as const
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

/** Shape check for what crosses the relay and MCP; the content stays the worker's. */
export function parseMapView(value: unknown): MapView {
  const view = object(value)
  if (Object.keys(view).some(key => !['at', 'window', 'kpis', 'systems', 'pods', 'collections', 'edges'].includes(key))) throw new Error('Invalid map view fields')
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
    nodes.add(id)
  }
  for (const item of list(view.collections, mapLimits.collections)) {
    const collection = object(item); const id = text(collection.id, 36); text(collection.name, 200)
    if (!['network', 'chain'].includes(String(collection.kind)) || !['active', 'paused', 'archived'].includes(String(collection.state))) throw new Error('Invalid map collection')
    for (const member of list(collection.members, 64)) { if (!nodes.has(text(member, 36))) throw new Error('Invalid map collection member') }
    for (const gate of list(collection.gates, 32)) { const row = object(gate); text(row.key, 64); text(row.title, 120); integer(row.open); nodes.add(`gate:${text(row.key, 64)}`) }
    nodes.add(id)
  }
  for (const item of list(view.edges, mapLimits.edges)) {
    const edge = object(item); integer(edge.flow)
    if (!['read', 'write', 'channel'].includes(String(edge.type)) || !nodes.has(text(edge.from, 4200)) || !nodes.has(text(edge.to, 4200))) throw new Error('Invalid map edge')
  }
  return structuredClone(view) as unknown as MapView
}
