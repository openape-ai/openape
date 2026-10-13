// @vitest-environment node
import { expect, it } from 'vitest'
import type { MapView } from '../../src/contracts/map-view'
import { parseMapView } from '../../src/contracts/map-view'
import { IDP, YOU, buildModel, curve, edgeWidth, geometry, hitTest, particleCount, relayout, step, visibleNodes } from '../../src/renderer/utils/automation-layout'
import { kpiFacts } from '../../src/renderer/utils/kpis'
import { withTags } from '../../src/renderer/utils/tags'
import fixture from './map-view.json'

const view = parseMapView(fixture) as MapView
const all = { data: true, read: true, write: true, auth: true, paused: true }
const byName = (name: string) => view.pods.find(pod => pod.name === name)!

it('turns the read model into columns: systems, pods, sinks, authorities; questions go to you and approvals to the identity provider', () => {
  const model = buildModel(view)
  const kind = (id: string) => model.nodes.find(node => node.id === id)?.kind
  expect(kind('app:o365-cli:phofmann@delta-mind.at')).toBe('system')
  // A service read by any Pod sits on the left; Telegram is read (GET) by the Calendar-Bot, so it is one node with two directions.
  expect(model.nodes.find(node => node.id === 'svc:https://api.telegram.org')).toMatchObject({ kind: 'system', both: true })
  expect(kind('dir:/Users/fixture/Briefing Evidence/mail')).toBe('system')
  expect(model.nodes.find(node => node.id === 'svc:https://zaz.delta-mind.at')).toMatchObject({ kind: 'system', both: true })
  expect(kind('ai:jev')).toBe('ai')
  expect(kind(YOU)).toBe('auth'); expect(kind(IDP)).toBe('auth')
  expect(model.nodes.find(node => node.id === YOU)!.badge).toBe(17)
  expect(model.nodes.some(node => node.name === 'Archived research')).toBe(false)
  expect(model.nodes.find(node => node.name === 'zaz Service-Agent')!.kind).toBe('pod')
  const classification = byName('Mail-Klassifizierung').id
  expect(model.links.find(link => link.from === classification && link.to === YOU)).toMatchObject({ type: 'auth', label: 'question', flow: 17 })
  expect(model.links.find(link => link.from === byName('Newsletter-Prüfung').id && link.to === IDP)).toMatchObject({ type: 'auth', label: 'approval', flow: 4 })
  expect(model.links.find(link => link.from === byName('IURIO PR monitor').id && link.to === IDP)).toMatchObject({ type: 'auth', label: 'Execution permission for IURIO PR monitor' })
  // Shared data runs from the writer to each reader, labelled with the namespace.
  expect(model.links.find(link => link.from === byName('Mail-Synchronisierung').id && link.to === classification)).toEqual({ from: byName('Mail-Synchronisierung').id, to: classification, type: 'data', label: 'delta-mind/mail/messages', flow: 20 })
  expect(model.links.filter(link => link.type === 'data' && link.from === classification).map(link => link.to).sort()).toEqual(['Antwortvorbereitung', 'Mail-Übersicht', 'Newsletter-Prüfung', 'Rechnungsprüfung', 'Wissensvorschläge'].map(name => byName(name).id).sort())
})

it('lays Pods that share data out in layers, the others in a row, and lets the canvas height follow the content; a tag filter keeps only connected systems', () => {
  const full = relayout(buildModel(view), view, all)
  const node = (name: string) => full.nodes.find(item => item.id === byName(name).id)!
  // Writer before reader: synchronisation, classification, then its five readers.
  expect(node('Mail-Synchronisierung').tx).toBeLessThan(node('Mail-Klassifizierung').tx)
  expect(node('Mail-Klassifizierung').tx).toBeLessThan(node('Rechnungsprüfung').tx)
  expect(node('Mail-Übersicht').tx).toBe(node('Rechnungsprüfung').tx)
  expect(node('Morgenbriefing · Redaktion').tx).toBeGreaterThan(node('Morgenbriefing · Kalender und Issues').tx)
  // A Pod without shared data sits in the row below the layers.
  expect(node('zaz Service-Agent').ty).toBeGreaterThan(Math.max(node('Rechnungsprüfung').ty, node('Mail-Übersicht').ty))
  expect(full.height).toBeGreaterThan(geometry.single.h + geometry.firstRow)
  const systems = full.nodes.filter(item => item.kind === 'system' && visibleNodes(full, all).has(item.id))
  expect(systems.every(item => item.tx === geometry.systemX)).toBe(true)
  expect(Math.max(...systems.map(item => item.ty))).toBeLessThanOrEqual(full.height - 60)
  const tagged = structuredClone(view)
  for (const item of tagged.pods.filter(item => item.name.startsWith('IURIO'))) item.tags = { own: ['iurio'], revision: 1 }
  const filtered = withTags(tagged, ['iurio'])
  const iurio = relayout(buildModel(filtered), filtered, all)
  const visible = visibleNodes(iurio, all)
  expect(Array.from(visible, id => iurio.nodes.find(item => item.id === id)!.name).filter(name => !name.startsWith('IURIO · ')).sort()).toEqual(['IURIO PR monitor', 'IURIO Task monitor', 'api.telegram.org', 'az', 'dev.azure.com', 'id.openape.ai', 'iurio', 'patrick@docpit.eu'])
  expect(iurio.height).toBeLessThan(full.height)
  const noPaused = visibleNodes(iurio, { ...all, paused: false })
  expect(noPaused.has('app:pods-mail:patrick@docpit.eu')).toBe(false)
})

it('eases nodes towards their targets, bends curves by link type and sizes particles and lines from measured flow', () => {
  const model = relayout(buildModel(view), view, all)
  for (const node of model.nodes) { node.x = 0; node.y = 0 }
  expect(step(model)).toBe(true)
  const first = model.nodes[0]!
  expect(first.x).toBeCloseTo(first.tx * 0.14, 5)
  for (let i = 0; i < 200; i++) step(model)
  expect(step(model)).toBe(false)
  expect(first.x).toBe(first.tx)
  const a = model.nodes.find(node => node.id === 'app:o365-cli:phofmann@delta-mind.at')!; const b = model.nodes.find(node => node.id === byName('Mail-Synchronisierung').id)!
  const read = curve(a, b, 'read'); const data = curve(b, model.nodes.find(node => node.id === byName('Mail-Klassifizierung').id)!, 'data')
  expect(data.c).toEqual({ x: (data.p0.x + data.p1.x) / 2, y: (data.p0.y + data.p1.y) / 2 })
  expect(Math.hypot(read.c.x - (read.p0.x + read.p1.x) / 2, read.c.y - (read.p0.y + read.p1.y) / 2)).toBeCloseTo(Math.min(60, Math.hypot(read.p1.x - read.p0.x, read.p1.y - read.p0.y) * 0.15), 5)
  expect([0, 1, 3, 10, 150].map(particleCount)).toEqual([0, 2, 3, 4, 5])
  expect([0, 3, 15, 100].map(edgeWidth)).toEqual([1, 1.5, 3.5, 3.5])
  expect(hitTest(model, visibleNodes(model, all), b.tx, b.ty)?.id).toBe(b.id)
  expect(hitTest(model, visibleNodes(model, all), 5, 5)).toBeNull()
})

it('derives KPI subtitles from the data only', () => {
  expect(kpiFacts(view)).toEqual({
    active: 5,
    paused: { total: 25, drafts: 1, archived: 1 },
    degraded: { count: 1, name: 'IURIO PR monitor', reason: 'completedWithGaps' },
    failures: { runs: 140, pods: [{ name: 'IURIO PR monitor', count: 137 }, { name: 'zaz Service-Agent', count: 3 }] },
    // The run waiting for an IdP approval and the grant requested at the IdP are rights, as in Entscheidungen.
    decisions: { count: 24, questions: 17, approvals: 4, rights: 2, reconcile: 1, secrets: 0 },
    unknownDeliveries: 1,
  })
})
