import type { ScheduleSpec } from './scheduling'
import { normalizeTags } from './tags'

/**
 * The read model behind the Automatisierungen surface: every Pod of the owner with the systems it reads and writes,
 * the shared data it writes and reads (issue 1465), measured flows of the last 24 hours and the five system KPIs.
 * Derived in the worker from existing tables, never stored; desktop, browser and MCP read the same JSON. Secrets
 * appear as aliases only.
 */
export type MapPodKind = 'source' | 'decision' | 'effect' | 'code'
export type MapSystemKind = 'service' | 'application' | 'directory' | 'ssh'
export type MapResourceKind = MapSystemKind | 'secret' | 'reference'
export interface MapSystem { id: string, kind: MapSystemKind, name: string, how: string }
export interface MapResource { kind: MapResourceKind, name: string, how: string, system: string | null }
/** `error` is the stored failure cause of the run; older publishers omit it. */
export interface MapRun { at: number, state: string, summary: string, error?: string | null }
/** `nextAt` is the next scheduled start; older publishers omit it. */
export interface MapSchedule { spec: ScheduleSpec | null, enabled: boolean, nextAt?: number | null }
export interface MapApproval { grantId: string, title: string, runId: string }
/** A grant this Pod requested at the IdP that waits for the owner there, with its IdP page; older publishers omit it. */
export interface MapGrant { grantId: string, title: string, url: string }
/** Owner tags of a Pod (issue 1459) with their revision. */
export interface MapTags { own: string[], revision: number }
export interface MapPod {
  id: string
  name: string
  revision: number
  script: string | null
  description: string | null
  lifecycle: 'active' | 'paused' | 'archived'
  draft: boolean
  kind: MapPodKind
  ai: boolean
  /** Shared data namespaces this Pod writes and reads. */
  data: { writes: string[], reads: string[] }
  /** Declared work waiting for this Pod and work held for the owner (blocked or unknown). */
  work: { pending: number, held: number }
  resources: MapResource[]
  secrets: string[]
  schedule: MapSchedule | null
  lastRun: MapRun | null
  runs: number
  queue: { blocked: number, error: string | null }
  approvals: MapApproval[]
  /** Pending IdP grants of this Pod that no waiting run already shows; older publishers omit it. */
  grants?: MapGrant[]
  /** Failed, interrupted and blocked runs started in the window; older publishers omit it. */
  failures?: number
  unknown: { key: string, runId: string }[]
  tags?: MapTags
}
/** `data` runs from the writer Pod of a namespace to each reader Pod; channel names the namespace. */
export interface MapEdge { from: string, to: string, type: 'read' | 'write' | 'data', channel: string | null, flow: number }
export interface MapKpis {
  active: number
  paused: number
  degraded: { podId: string, reason: string }[]
  decisions: { podId: string, kind: 'question' | 'approval', title: string, count: number }[]
  unknownDeliveries: number
}
export interface MapView { at: number, window: { from: number, to: number }, kpis: MapKpis, systems: MapSystem[], pods: MapPod[], edges: MapEdge[] }

export const mapLimits = { pods: 100, systems: 400, edges: 4000, namespaces: 256 } as const
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

function tags(value: unknown): void {
  if (value === undefined) return
  const item = object(value)
  if (Object.keys(item).some(key => !['own', 'revision'].includes(key)) || !Number.isSafeInteger(item.revision) || Number(item.revision) < 0 || JSON.stringify(normalizeTags(item.own)) !== JSON.stringify(item.own)) throw new Error('Invalid map tags')
}

function grants(value: unknown): void {
  for (const item of list(value, 64)) {
    const grant = object(item); text(grant.title, 4096)
    // The same issuers a run approval accepts: HTTPS, or the loopback IdP of a local test stack.
    const url = URL.parse(text(grant.url, 4096))
    if (typeof grant.grantId !== 'string' || !/^[\w-]{1,128}$/.test(grant.grantId) || !url || !(url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === '127.0.0.1'))) throw new Error('Invalid map grant')
  }
}

/** Shape check for what crosses the relay and MCP; the content stays the worker's. */
export function parseMapView(value: unknown): MapView {
  const view = object(value)
  if (Object.keys(view).some(key => !['at', 'window', 'kpis', 'systems', 'pods', 'edges'].includes(key))) throw new Error('Invalid map view fields')
  integer(view.at); const window = object(view.window); integer(window.from); integer(window.to)
  const kpis = object(view.kpis); integer(kpis.active); integer(kpis.paused); integer(kpis.unknownDeliveries)
  for (const item of list(kpis.degraded, mapLimits.pods)) { const row = object(item); text(row.podId, 36); text(row.reason) }
  for (const item of list(kpis.decisions, 512)) {
    const row = object(item); text(row.podId, 36); text(row.title, 300); integer(row.count)
    if (!['question', 'approval'].includes(String(row.kind))) throw new Error('Invalid map decision')
  }
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
    tags(pod.tags)
    if (pod.failures !== undefined) integer(pod.failures)
    if (pod.grants !== undefined) grants(pod.grants)
    const data = object(pod.data)
    for (const path of [...list(data.writes, mapLimits.namespaces), ...list(data.reads, mapLimits.namespaces)]) text(path, 200)
    const work = object(pod.work); integer(work.pending); integer(work.held)
    nodes.add(id)
  }
  for (const item of list(view.edges, mapLimits.edges)) {
    const edge = object(item); integer(edge.flow)
    if (!['read', 'write', 'data'].includes(String(edge.type)) || !nodes.has(text(edge.from, 4200)) || !nodes.has(text(edge.to, 4200))) throw new Error('Invalid map edge')
  }
  return structuredClone(view) as unknown as MapView
}
