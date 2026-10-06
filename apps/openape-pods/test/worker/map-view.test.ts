// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { parseMapView } from '../../src/contracts/map-view'
import { parseWorkspace } from '../../src/contracts/control'
import { parseWorkspaceAction } from '../../src/contracts/codex'
import { mapView, mapWindowMs } from '../../src/worker/workspace/map-view'
import { closeNetworks } from '../scheduling/network-fixture'
import { mapFixture, NOW } from './map-fixture'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
afterEach(async () => { await closeNetworks(); vi.restoreAllMocks() })

it('derives systems, pods, collections, measured edges and KPIs from the stored rows of the last 24 hours', () => {
  const f = mapFixture()
  const started = performance.now()
  const view = parseMapView(mapView(f.store, NOW))
  const elapsed = performance.now() - started
  expect(elapsed).toBeLessThan(500)
  expect(view.at).toBe(Math.floor(NOW / 60000) * 60000)
  expect(view.window).toEqual({ from: view.at - mapWindowMs, to: view.at })
  expect(view.pods).toHaveLength(38)
  expect(parseWorkspace({ pods: [], organization: { revision: 1, groups: [] }, map: view }).map).toEqual(view)

  // Systems: one node per origin, program and account, folder or host, shared by every Pod that uses it.
  const telegram = view.systems.find(system => system.id === 'svc:https://api.telegram.org')!
  expect(telegram).toEqual({ id: 'svc:https://api.telegram.org', kind: 'service', name: 'api.telegram.org', how: 'GET, POST' })
  expect(view.systems.filter(system => system.id.startsWith('app:o365-cli:'))).toEqual([{ id: 'app:o365-cli:phofmann@delta-mind.at', kind: 'application', name: 'phofmann@delta-mind.at', how: 'o365-cli' }])
  expect(view.systems.find(system => system.kind === 'directory')).toMatchObject({ id: 'dir:/Users/fixture/Pods/delta', name: 'delta' })
  expect(view.systems.filter(system => system.kind === 'ssh')).toHaveLength(5)
  expect(view.systems.find(system => system.id === 'ai:jev')).toMatchObject({ kind: 'service', how: 'jev-1.13.0' })

  // Pods: kind, AI, channels, resources by kind with secrets as aliases only, schedule, last run and queue.
  const triage = view.pods.find(pod => pod.id === f.pods.Triage)!
  expect(triage).toMatchObject({ name: 'Triage', group: 'Delta Mind', lifecycle: 'active', kind: 'decision', ai: true, collection: f.network, channels: { takes: ['mail.filtered'], gives: ['mail.triaged'] }, runs: 10, secrets: [] })
  expect(triage.resources).toEqual([{ kind: 'service', name: 'TypeSafe / Jev', how: 'jev-1.13.0 · 20', system: 'ai:jev' }, { kind: 'directory', name: 'delta', how: 'readWrite', system: 'dir:/Users/fixture/Pods/delta' }])
  const intake = view.pods.find(pod => pod.id === f.pods.Intake)!
  expect(intake).toMatchObject({ kind: 'source', schedule: { spec: { kind: 'interval', seconds: 900 }, enabled: true }, lastRun: { state: 'completed', summary: 'Read 6 sampled messages and emitted 0 changed provider versions. No mailbox writes.' } })
  expect(intake.resources.find(resource => resource.kind === 'application')).toEqual({ kind: 'application', name: 'o365-cli', how: 'List emails in inbox for phofmann@delta-mind.at; Read email from account phofmann@delta-mind.at', system: 'app:o365-cli:phofmann@delta-mind.at' })
  const bot = view.pods.find(pod => pod.name === 'Morgenbriefing · Calendar-Bot')!
  expect(bot).toMatchObject({ kind: 'effect', ai: false, group: null, collection: f.briefing, secrets: ['calendar_bot_token', 'reports_publisher_key'], schedule: null })
  expect(JSON.stringify(view)).not.toMatch(/credentialId|"value"/)
  const monitor = view.pods.find(pod => pod.name === 'IURIO PR monitor')!
  expect(monitor).toMatchObject({ group: 'iurio', collection: null, lastRun: { state: 'running' }, approvals: [{ grantId: 'grant-pr-monitor', title: 'Execution permission for IURIO PR monitor' }], schedule: { spec: { kind: 'interval', seconds: 900 }, enabled: true } })
  expect(view.pods.find(pod => pod.name === 'Daily action website')).toMatchObject({ draft: true, lifecycle: 'paused', kind: 'code' })
  expect(view.pods.find(pod => pod.name === 'Archived research')).toMatchObject({ lifecycle: 'archived', group: null })

  // Collections: the persistent network with its gates, the daily chain, the paused bounded graphs and the cron chain.
  const network = view.collections.find(collection => collection.id === f.network)!
  expect(network).toMatchObject({ kind: 'network', bounded: false, name: 'Delta Mind · Mail-Netzwerk', group: 'Delta Mind', state: 'active', schedule: { spec: { kind: 'interval', seconds: 900 }, enabled: true }, counts: { done: 80 } })
  expect(network.members).toHaveLength(11)
  expect(network.flows).toEqual({ 'mail.open': 3, 'mail.filtered': 7, 'mail.triaged': 8, 'mail.useful': 1, 'mail.reply': 1, 'mail.reviewed': 1, 'draft.candidate': 1, 'mail.unsure': 14 })
  expect(network.gates).toEqual([
    { key: 'uncertain-review', kind: 'choose', title: 'Review uncertain mail', takes: 'mail.unsure', options: [{ key: 'keep', title: 'Keep for review', channel: 'mail.useful' }, { key: 'newsletter', title: 'Newsletter candidate', channel: 'mail.newsletter' }, { key: 'invoice', title: 'Invoice review', channel: 'mail.invoice' }, { key: 'reply', title: 'Reply preview', channel: 'mail.reply' }], open: 17, batches: {} },
    { key: 'newsletter-approval', kind: 'approve', title: 'Approve newsletter preview (no move)', takes: 'mail.batch', options: [{ key: 'approve', title: 'Approve newsletter preview (no move)', channel: 'mail.approved' }], open: 0, batches: {} },
  ])
  expect(view.collections.find(collection => collection.id === f.briefing)).toMatchObject({ kind: 'chain', state: 'active', group: null, members: [f.pods['Mail-Prüfung · Morgenbriefing'], expect.any(String), expect.any(String), bot.id], schedule: { spec: { kind: 'daily', time: '07:00', timezone: 'Europe/Vienna' }, enabled: true }, lastRun: { state: 'completed' } })
  expect(view.collections.find(collection => collection.id === f.docpit)).toMatchObject({ kind: 'network', bounded: true, state: 'paused', group: 'iurio', flows: {}, gates: [expect.objectContaining({ key: 'uncertain-review', open: 0 }), expect.objectContaining({ key: 'newsletter-approval' })] })
  expect(view.collections.find(collection => collection.id === f.serverReport)).toMatchObject({ kind: 'chain', state: 'paused', group: 'Linde', schedule: { spec: { kind: 'cron', expression: '0 8 * * 1,4', timezone: 'Europe/Vienna' }, enabled: false } })
  expect(view.collections.map(collection => collection.name).sort()).toEqual(['Delta Mind · Mail-Netzwerk', 'IURIO · DOCPIT mail management', 'Linde · Portal development and systems', 'Linde · Server report', 'Morgenbriefing'])

  // Edges: channel flows from accepted events, reads counted by runs, writes by ledger entries; a mailbox read and written is one node with two edges.
  const edge = (from: string, to: string, type: string) => view.edges.find(item => item.from === from && item.to === to && item.type === type)
  expect(edge(f.pods.Intake!, f.pods['List filter']!, 'channel')).toEqual({ from: f.pods.Intake, to: f.pods['List filter'], type: 'channel', channel: 'mail.open', flow: 3 })
  expect(edge(f.pods.Categorisation!, 'gate:uncertain-review', 'channel')).toMatchObject({ channel: 'mail.unsure', flow: 14 })
  expect(edge('gate:uncertain-review', f.pods.Review!, 'channel')).toMatchObject({ channel: 'mail.useful', flow: 1 })
  expect(edge('app:o365-cli:phofmann@delta-mind.at', f.pods.Intake!, 'read')).toMatchObject({ flow: 10 })
  expect(edge(f.pods['Archive preview']!, 'app:o365-cli:phofmann@delta-mind.at', 'write')).toMatchObject({ flow: 0 })
  expect(edge('svc:https://zaz.delta-mind.at', view.pods.find(pod => pod.name === 'zaz Service-Agent')!.id, 'read')).toMatchObject({ flow: 150 })
  expect(edge(monitor.id, 'svc:https://api.telegram.org', 'write')).toMatchObject({ flow: 5 })
  expect(edge('svc:https://api.telegram.org', monitor.id, 'read')).toBeUndefined()
  expect(edge(f.pods['Mail-Prüfung · Morgenbriefing']!, view.pods.find(pod => pod.name === 'Morgenbriefing · Kalender und Issues')!.id, 'channel')).toMatchObject({ channel: 'handoff', flow: 1 })
  expect(view.edges.filter(item => item.type === 'channel' && view.collections.find(collection => collection.id === f.docpit)!.members.includes(item.from)).length).toBeGreaterThan(8)

  // KPIs: top-level automations (five collections, six standalone Pods), the degraded monitor that is running again, the open gate and nothing to reconcile.
  expect(view.kpis).toEqual({
    active: 5, paused: 6,
    degraded: [{ podId: monitor.id, reason: 'completedWithGaps' }],
    decisions: [{ networkId: f.network, gate: 'uncertain-review', title: 'Review uncertain mail', kind: 'choose', count: 17 }],
    unknownDeliveries: 1,
  })
  expect(bot.unknown).toHaveLength(1)
  f.store.db.prepare('UPDATE effect_ledger SET state=\'unknown\' WHERE rowid=(SELECT max(rowid) FROM effect_ledger)').run()
  f.store.db.prepare('INSERT INTO accepted_events(id,pod_id,source,dedupe_key,payload,accepted_at,state,error) VALUES(?,?,\'schedule\',\'k\',\'{}\',?,\'blocked\',\'Execution permission requires owner review\')').run('event-blocked', monitor.id, NOW)
  const later = mapView(f.store, NOW)
  expect(later.kpis.unknownDeliveries).toBe(2)
  expect(later.kpis.degraded).toEqual([{ podId: monitor.id, reason: 'Execution permission requires owner review' }])
  expect(later.pods.find(pod => pod.id === monitor.id)!.queue).toEqual({ blocked: 1, error: 'Execution permission requires owner review' })
})

it('keeps the rights, runs and systems of network members out of the published variant', () => {
  const f = mapFixture()
  const view = parseMapView(mapView(f.store, NOW, true))
  const intake = view.pods.find(pod => pod.id === f.pods.Intake)!
  expect(intake).toMatchObject({ resources: [], secrets: [], lastRun: null, runs: 0, approvals: [], queue: { blocked: 0, error: null }, channels: { takes: [], gives: ['mail.open', 'mail.sent-raw'] }, schedule: { spec: { kind: 'interval', seconds: 900 }, enabled: true } })
  expect(view.edges.filter(edge => edge.type !== 'channel' && (edge.from === intake.id || edge.to === intake.id))).toEqual([])
  expect(view.edges.find(edge => edge.from === intake.id && edge.channel === 'mail.open')).toMatchObject({ flow: 3 })
  expect(view.systems.some(system => system.id === 'dir:/Users/fixture/Pods/delta')).toBe(false)
  expect(view.collections.find(collection => collection.id === f.network)).toMatchObject({ lastRun: null, flows: { 'mail.unsure': 14 }, gates: [expect.objectContaining({ open: 17 }), expect.anything()] })
  expect(view.pods.find(pod => pod.name === 'IURIO PR monitor')!.resources.length).toBeGreaterThan(0)
  expect(view.kpis).toMatchObject({ active: 5, decisions: [expect.objectContaining({ count: 17 })] })
})

it('reads the map through the workspace query without a Pod and keeps the other views unchanged', () => {
  const runtimeId = '00000000-0000-4000-8000-000000000138'
  expect(parseWorkspaceAction({ action: 'workspace', query: { type: 'read', runtimeId, view: 'map' } })).toEqual({ type: 'read', runtimeId, view: 'map' })
  expect(() => parseWorkspaceAction({ action: 'workspace', query: { type: 'read', runtimeId, view: 'map', podId: runtimeId } })).toThrow('Invalid workspace read view')
  expect(() => parseWorkspaceAction({ action: 'workspace', query: { type: 'read', runtimeId, view: 'summary' } })).toThrow('Invalid workspace identity')
  expect(() => parseMapView({ at: 1, window: { from: 0, to: 1 }, kpis: { active: 0, paused: 0, degraded: [], decisions: [], unknownDeliveries: 0 }, systems: [], pods: [], collections: [], edges: [{ from: 'x', to: 'y', type: 'read', channel: null, flow: 1 }] })).toThrow('Invalid map edge')
})
