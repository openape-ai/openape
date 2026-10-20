import type { MapSystemKind, MapView } from '../../contracts/map-view'

/**
 * The picture of the Automatisierungen map: fixed columns (systems left, Pods in the middle, pure
 * sinks right, authorities and AI on top), no force layout. Pods occupy bounded rows.
 * Nodes glide to their targets; the canvas height follows the content.
 * All numbers are logical canvas units (width 1200).
 */
export type NodeKind = 'pod' | 'system' | 'sink' | 'auth' | 'ai'
export type LinkType = 'read' | 'write' | 'auth'
export interface MapNode {
  id: string
  kind: NodeKind
  name: string
  sub: string
  paused: boolean
  ai: boolean
  degraded: boolean
  blocked: boolean
  running: boolean
  rk: MapSystemKind | null
  both: boolean
  badge: number
  secrets: boolean
  labelWidth: number
  x: number
  y: number
  tx: number
  ty: number
}
export interface MapLink { from: string, to: string, type: LinkType, label: string, flow: number }
export interface MapModel { nodes: MapNode[], links: MapLink[], height: number }
export interface Layers { read: boolean, write: boolean, auth: boolean, paused: boolean }
export const canvasWidth = 1200
export const geometry = { systemX: 100, sinkX: 1095, topY: 56, topGap: 270, firstRow: 150, rowGap: 30, single: { h: 80, gap: 170 }, podRadius: 18, columnStart: 200, columnStep: 90, minimumHeight: 420 } as const
export const boxSize = (kind: NodeKind): { w: number, h: number } => kind === 'sink' ? { w: 190, h: 40 } : kind === 'auth' || kind === 'ai' ? { w: 160, h: 40 } : kind === 'pod' ? { w: 36, h: 36 } : { w: 160, h: 40 }
export const IDP = 'auth:idp'
export const YOU = 'auth:you'

const node = (id: string, kind: NodeKind, name: string, extra: Partial<MapNode> = {}): MapNode => ({ id, kind, name, sub: '', paused: false, ai: false, degraded: false, blocked: false, running: false, rk: null, both: false, badge: 0, secrets: false, labelWidth: 150, x: 0, y: 0, tx: 0, ty: 0, ...extra })

/** Nodes and links of the read model; open questions link a Pod to the owner, requested approvals to the identity provider. */
export function buildModel(view: MapView, previous?: MapModel): MapModel {
  const nodes: MapNode[] = []
  const links: MapLink[] = []
  const degraded = new Set(view.kpis.degraded.map(item => item.podId))
  const shown = new Set<string>()
  for (const pod of view.pods) {
    if (pod.lifecycle === 'archived') continue
    shown.add(pod.id)
    nodes.push(node(pod.id, 'pod', pod.name, { paused: pod.lifecycle === 'paused', ai: pod.ai, degraded: degraded.has(pod.id), blocked: false, running: pod.lastRun?.state === 'running', secrets: pod.secrets.length > 0 }))
    for (const approval of pod.approvals) links.push({ from: pod.id, to: IDP, type: 'auth', label: approval.title, flow: 1 })
  }
  for (const decision of view.kpis.decisions.filter(item => shown.has(item.podId))) links.push({ from: decision.podId, to: decision.kind === 'question' ? YOU : IDP, type: 'auth', label: decision.kind, flow: decision.count })
  const reads = new Set(view.edges.filter(edge => edge.type === 'read').map(edge => edge.from))
  const writes = new Set(view.edges.filter(edge => edge.type === 'write').map(edge => edge.to))
  for (const system of view.systems) {
    const kind: NodeKind = system.id.startsWith('ai:') ? 'ai' : reads.has(system.id) ? 'system' : 'sink'
    nodes.push(node(system.id, kind, system.name, { sub: system.how, rk: system.kind, both: reads.has(system.id) && writes.has(system.id) }))
  }
  for (const edge of view.edges.filter(edge => edge.type !== 'data')) links.push({ from: edge.from, to: edge.to, type: edge.type as 'read' | 'write', label: edge.channel ?? '', flow: edge.flow })
  const questions = view.kpis.decisions.filter(item => item.kind === 'question').reduce((sum, item) => sum + item.count, 0)
  if (links.some(link => link.from === YOU || link.to === YOU)) nodes.push(node(YOU, 'auth', 'you', { badge: questions }))
  if (links.some(link => link.from === IDP || link.to === IDP)) nodes.push(node(IDP, 'auth', 'id.openape.ai', { sub: 'idp' }))
  const unique = new Map<string, MapLink>()
  for (const link of links) {
    if (link.from === link.to) continue
    const key = `${link.from}>${link.to}>${link.type}>${link.label}`
    const existing = unique.get(key)
    if (existing) existing.flow += link.flow
    else unique.set(key, { ...link })
  }
  const known = new Map(previous?.nodes.map(item => [item.id, item]))
  for (const item of nodes) { const before = known.get(item.id); if (before) { item.x = before.x; item.y = before.y } }
  return { nodes, links: [...unique.values()], height: geometry.minimumHeight }
}

/** A Pod is visible when its layer is selected; a system or authority when it is connected to a visible Pod. */
export function visibleNodes(model: MapModel, layers: Layers): Set<string> {
  const own = new Set(model.nodes.filter(item => item.kind === 'pod' && (layers.paused || !item.paused)).map(item => item.id))
  const visible = new Set(own)
  for (const link of model.links) {
    if (!layers[link.type]) continue
    if (own.has(link.from) && model.nodes.some(item => item.id === link.to && item.kind !== 'pod')) visible.add(link.to)
    if (own.has(link.to) && model.nodes.some(item => item.id === link.from && item.kind !== 'pod')) visible.add(link.from)
  }
  return visible
}

/** Places every visible node in its column or row; the canvas height follows the content. */
export function relayout(model: MapModel, view: MapView, layers: Layers): MapModel {
  const visible = visibleNodes(model, layers)
  const shown = model.nodes.filter(item => visible.has(item.id))
  const g = geometry
  const row = (items: MapNode[], y: number, gap: number, cx = 600) => { const w = (items.length - 1) * gap; items.forEach((item, index) => { item.tx = cx - w / 2 + index * gap; item.ty = y }) }
  const column = (items: MapNode[], x: number, y0: number, y1: number) => items.forEach((item, index) => { item.tx = x; item.ty = items.length === 1 ? (y0 + y1) / 2 : y0 + (y1 - y0) * index / (items.length - 1) })
  row(shown.filter(item => item.kind === 'auth' || item.kind === 'ai'), g.topY, g.topGap)
  let y = g.firstRow
  const pods = shown.filter(item => item.kind === 'pod')
  for (let index = 0; index < pods.length; index += 4) {
    const group = pods.slice(index, index + 4)
    for (const item of group) item.labelWidth = g.single.gap - 10
    row(group, y + g.single.h / 2 - 10, g.single.gap)
    y += g.single.h + g.rowGap
  }
  const systems = shown.filter(item => item.kind === 'system'); const sinks = shown.filter(item => item.kind === 'sink')
  const columns = Math.max(systems.length, sinks.length)
  const height = Math.max(g.minimumHeight, y - g.rowGap + 30, g.columnStart + (columns - 1) * g.columnStep + 60)
  column(systems, g.systemX, g.columnStart, height - 60)
  column(sinks, g.sinkX, g.columnStart, height - 60)
  for (const item of model.nodes) {
    if (!item.x && !item.y) { item.x = item.tx; item.y = item.ty }
  }
  return { ...model, height }
}

/** Moves every node a step towards its target; instant under reduced motion. */
export function step(model: MapModel, factor = 0.14): boolean {
  let moving = false
  for (const item of model.nodes) {
    const dx = item.tx - item.x; const dy = item.ty - item.y
    if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) { item.x = item.tx; item.y = item.ty; continue }
    item.x += dx * factor; item.y += dy * factor; moving = true
  }
  return moving
}

export function anchor(item: MapNode, toward: { x: number, y: number }): { x: number, y: number } {
  const dx = toward.x - item.x; const dy = toward.y - item.y; const d = Math.hypot(dx, dy) || 1
  if (item.kind === 'pod') return { x: item.x + dx / d * geometry.podRadius, y: item.y + dy / d * geometry.podRadius }
  const { w, h } = boxSize(item.kind); const hw = w / 2; const hh = h / 2
  const k = Math.min(hw / Math.abs(dx || 1e-6), hh / Math.abs(dy || 1e-6))
  return { x: item.x + dx * k, y: item.y + dy * k }
}

/** A quadratic curve from a to b; links bend 15 % of their length (at most 60), write-backs to a left system the other way. */
export function curve(a: MapNode, b: MapNode, type: LinkType): { p0: { x: number, y: number }, p1: { x: number, y: number }, c: { x: number, y: number } } {
  const p0 = anchor(a, b); const p1 = anchor(b, a)
  const mx = (p0.x + p1.x) / 2; const my = (p0.y + p1.y) / 2
  const dx = p1.x - p0.x; const dy = p1.y - p0.y; const d = Math.hypot(dx, dy) || 1
  const bend = Math.min(60, d * 0.15) * (a.id < b.id ? 1 : -1) * (type === 'write' && b.kind === 'system' ? -1.6 : 1)
  return { p0, p1, c: { x: mx - dy / d * bend, y: my + dx / d * bend } }
}
export const pointAt = (c: ReturnType<typeof curve>, t: number) => ({ x: (1 - t) * (1 - t) * c.p0.x + 2 * (1 - t) * t * c.c.x + t * t * c.p1.x, y: (1 - t) * (1 - t) * c.p0.y + 2 * (1 - t) * t * c.c.y + t * t * c.p1.y })
export const particleCount = (flow: number): number => flow <= 0 ? 0 : Math.min(5, 1 + Math.round(Math.log2(1 + flow)))
export const edgeWidth = (flow: number): number => flow > 0 ? 1 + Math.min(2.5, flow / 6) : 1

export function hitTest(model: MapModel, visible: Set<string>, x: number, y: number): MapNode | null {
  for (const item of model.nodes) {
    if (!visible.has(item.id)) continue
    const { w, h } = item.kind === 'pod' ? { w: 40, h: 40 } : boxSize(item.kind)
    if (Math.abs(x - item.x) <= w / 2 && Math.abs(y - item.y) <= h / 2) return item
  }
  return null
}

export interface NodeFacts { reads: { name: string, flow: number }[], writes: { name: string, flow: number }[] }
/** What one node reads and writes, with the measured flows of the window. */
export function nodeFacts(view: MapView, id: string): NodeFacts {
  const name = (systemId: string) => view.systems.find(system => system.id === systemId)?.name ?? systemId
  return {
    reads: view.edges.filter(edge => edge.type === 'read' && edge.to === id).map(edge => ({ name: name(edge.from), flow: edge.flow })),
    writes: view.edges.filter(edge => edge.type === 'write' && edge.from === id).map(edge => ({ name: name(edge.to), flow: edge.flow })),
  }
}

/**
 * Canvas cannot parse `light-dark()` tokens; the computed colour of a probe element can. One probe
 * per map, refreshed when the scheme changes.
 */
export function colorResolver(host: HTMLElement): (token: string) => string {
  const probe = document.createElement('span')
  probe.setAttribute('aria-hidden', 'true'); probe.style.display = 'none'
  host.appendChild(probe)
  const cache = new Map<string, string>()
  return (token: string) => {
    const cached = cache.get(token)
    if (cached) return cached
    probe.style.color = `var(${token})`
    const value = getComputedStyle(probe).color
    cache.set(token, value)
    return value
  }
}
