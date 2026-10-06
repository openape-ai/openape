// @vitest-environment node
import { expect, it } from 'vitest'
import type { MapView } from '../../src/contracts/map-view'
import { parseMapView } from '../../src/contracts/map-view'
import { IDP, YOU, buildModel, curve, edgeWidth, geometry, hitTest, particleCount, relayout, step, ungrouped, visibleNodes } from '../../src/renderer/utils/automation-layout'
import { kpiFacts } from '../../src/renderer/utils/kpis'
import fixture from './map-view.json'

const view = parseMapView(fixture) as MapView
const all = { channel: true, read: true, write: true, auth: true, paused: true }
const byName = (name: string) => view.pods.find(pod => pod.name === name)!

it('turns the read model into columns: systems, pods, sinks, authorities; paused collections collapse and gates become you or the identity provider', () => {
  const model = buildModel(view)
  const kind = (id: string) => model.nodes.find(node => node.id === id)?.kind
  expect(kind('app:o365-cli:phofmann@delta-mind.at')).toBe('system')
  // A service read by any Pod sits on the left; Telegram is read (GET) by the Calendar-Bot, so it is one node with two directions.
  expect(model.nodes.find(node => node.id === 'svc:https://api.telegram.org')).toMatchObject({ kind: 'system', both: true })
  expect(kind('dir:/Users/fixture/Briefing Evidence/mail')).toBe('system')
  expect(kind('svc:https://zaz.delta-mind.at')).toBe('system')
  expect(model.nodes.find(node => node.id === 'svc:https://zaz.delta-mind.at')!.both).toBe(true)
  expect(kind('ai:jev')).toBe('ai')
  expect(kind(YOU)).toBe('auth'); expect(kind(IDP)).toBe('auth')
  expect(model.nodes.find(node => node.id === YOU)!.badge).toBe(17)
  const docpit = view.collections.find(collection => collection.name.startsWith('IURIO'))!
  expect(model.nodes.find(node => node.id === docpit.id)).toMatchObject({ kind: 'collapsed', sub: '11', paused: true, group: 'iurio' })
  expect(model.nodes.some(node => node.id === docpit.members[0])).toBe(false)
  expect(model.nodes.some(node => node.name === 'Archived research')).toBe(false)
  expect(model.nodes.find(node => node.name === 'zaz Service-Agent')!.group).toBe(ungrouped)
  const categorisation = byName('Categorisation').id
  expect(model.links.find(link => link.from === categorisation && link.to === YOU)).toMatchObject({ type: 'auth', label: 'mail.unsure', flow: 14 })
  expect(model.links.find(link => link.from === YOU && link.to === byName('Review').id)).toMatchObject({ type: 'auth', label: 'mail.useful' })
  expect(model.links.find(link => link.from === byName('IURIO PR monitor').id && link.to === IDP)).toMatchObject({ type: 'auth', label: 'Execution permission for IURIO PR monitor' })
  // The collapsed graph keeps one read edge from the DOCPIT mailbox.
  expect(model.links.filter(link => link.to === docpit.id && link.type === 'read')).toEqual([{ from: 'app:pods-mail:patrick@docpit.eu', to: docpit.id, type: 'read', label: '', flow: 0 }])
  expect(model.links.filter(link => link.from === docpit.id && link.type === 'auth').map(link => link.to)).toEqual([YOU, IDP])
})

it('lays rows out from the top and lets the canvas height follow the content; a group filter keeps only connected systems', () => {
  const full = relayout(buildModel(view), view, 'all', all)
  const network = full.clusters.find(cluster => cluster.kind === 'network')!
  expect(network).toMatchObject({ x: geometry.cluster.x, y: geometry.firstRow, w: geometry.cluster.w, h: geometry.cluster.h })
  const chain = full.clusters.find(cluster => cluster.kind === 'chain')!
  expect(chain.y).toBe(geometry.firstRow + geometry.cluster.h + geometry.rowGap)
  const chainMembers = view.collections.find(collection => collection.kind === 'chain' && collection.state === 'active')!.members.map(id => full.nodes.find(node => node.id === id)!)
  expect(chainMembers.map(node => node.tx)).toEqual(chainMembers.map((_, index) => 600 - (chainMembers.length - 1) * geometry.chain.gap / 2 + index * geometry.chain.gap))
  expect(full.height).toBeGreaterThan(geometry.cluster.h + geometry.chain.h + geometry.single.h + geometry.collapsed.h + geometry.firstRow)
  const systems = full.nodes.filter(node => node.kind === 'system' && visibleNodes(full, 'all', all).has(node.id))
  expect(systems.every(node => node.tx === geometry.systemX)).toBe(true)
  expect(Math.max(...systems.map(node => node.ty))).toBeLessThanOrEqual(full.height - 60)
  const iurio = relayout(buildModel(view), view, 'iurio', all)
  const visible = visibleNodes(iurio, 'iurio', all)
  expect(Array.from(visible, id => iurio.nodes.find(node => node.id === id)!.name).sort()).toEqual(['IURIO PR monitor', 'IURIO Task monitor', 'IURIO · DOCPIT mail management', 'api.telegram.org', 'az', 'dev.azure.com', 'id.openape.ai', 'iurio', 'patrick@docpit.eu', 'you'])
  // Five systems on the left need more height than the minimum, less than the full map.
  expect(iurio.height).toBe(geometry.columnStart + 4 * geometry.columnStep + 60)
  expect(iurio.height).toBeLessThan(full.height)
  expect(iurio.clusters).toEqual([])
  const noPaused = visibleNodes(iurio, 'iurio', { ...all, paused: false })
  expect([...noPaused].some(id => iurio.nodes.find(node => node.id === id)!.kind === 'collapsed')).toBe(false)
  expect(noPaused.has('app:pods-mail:patrick@docpit.eu')).toBe(false)
})

it('eases nodes towards their targets, bends curves by link type and sizes particles and lines from measured flow', () => {
  const model = relayout(buildModel(view), view, 'all', all)
  for (const node of model.nodes) { node.x = 0; node.y = 0 }
  expect(step(model)).toBe(true)
  const first = model.nodes[0]!
  expect(first.x).toBeCloseTo(first.tx * 0.14, 5)
  for (let i = 0; i < 200; i++) step(model)
  expect(step(model)).toBe(false)
  expect(first.x).toBe(first.tx)
  const a = model.nodes.find(node => node.id === 'app:o365-cli:phofmann@delta-mind.at')!; const b = model.nodes.find(node => node.id === byName('Intake').id)!
  const read = curve(a, b, 'read'); const channel = curve(b, model.nodes.find(node => node.id === byName('List filter').id)!, 'channel')
  expect(channel.c).toEqual({ x: (channel.p0.x + channel.p1.x) / 2, y: (channel.p0.y + channel.p1.y) / 2 })
  expect(Math.hypot(read.c.x - (read.p0.x + read.p1.x) / 2, read.c.y - (read.p0.y + read.p1.y) / 2)).toBeCloseTo(Math.min(60, Math.hypot(read.p1.x - read.p0.x, read.p1.y - read.p0.y) * 0.15), 5)
  expect([0, 1, 3, 10, 150].map(particleCount)).toEqual([0, 2, 3, 4, 5])
  expect([0, 3, 15, 100].map(edgeWidth)).toEqual([1, 1.5, 3.5, 3.5])
  expect(hitTest(model, visibleNodes(model, 'all', all), b.tx, b.ty)?.id).toBe(b.id)
  expect(hitTest(model, visibleNodes(model, 'all', all), 5, 5)).toBeNull()
})

it('derives KPI subtitles from the data only', () => {
  expect(kpiFacts(view)).toEqual({
    active: 5,
    paused: { total: 6, networks: 2, drafts: 1, archived: 1 },
    degraded: { count: 1, name: 'IURIO PR monitor', reason: 'completedWithGaps' },
    decisions: { count: 17, gates: [{ title: 'Review uncertain mail', group: 'Delta Mind' }] },
    unknownDeliveries: 1,
  })
})
