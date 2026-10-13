// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { parseMapView } from '../../src/contracts/map-view'
import { parseWorkspace } from '../../src/contracts/control'
import { parseWorkspaceAction } from '../../src/contracts/codex'
import { mapView, mapWindowMs } from '../../src/worker/workspace/map-view'
import { closeMapFixtures, mapFixture, NOW } from './map-fixture'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
afterEach(() => { closeMapFixtures(); vi.restoreAllMocks() })

it('derives systems, pods, shared data, measured edges and KPIs from the stored rows of the last 24 hours', () => {
  const f = mapFixture()
  const started = performance.now()
  const view = parseMapView(mapView(f.store, NOW))
  const elapsed = performance.now() - started
  expect(elapsed).toBeLessThan(500)
  expect(view.at).toBe(Math.floor(NOW / 60000) * 60000)
  expect(view.window).toEqual({ from: view.at - mapWindowMs, to: view.at })
  expect(view.pods).toHaveLength(30)
  expect(view).not.toHaveProperty('automations')
  // A desktop before issue 1468 still publishes its groups; readers ignore them.
  expect(parseWorkspace({ pods: [], organization: { revision: 2, groups: [{ id: f.pods['Mail-Klassifizierung'], name: 'Delta Mind', collapsed: false, podIds: [] }] }, map: view }).map).toEqual(view)

  // Systems: one node per origin, program and account, folder or host, shared by every Pod that uses it.
  const telegram = view.systems.find(system => system.id === 'svc:https://api.telegram.org')!
  expect(telegram).toEqual({ id: 'svc:https://api.telegram.org', kind: 'service', name: 'api.telegram.org', how: 'GET, POST' })
  expect(view.systems.filter(system => system.id.startsWith('app:o365-cli:'))).toEqual([{ id: 'app:o365-cli:phofmann@delta-mind.at', kind: 'application', name: 'phofmann@delta-mind.at', how: 'o365-cli' }])
  expect(view.systems.find(system => system.kind === 'directory')).toMatchObject({ id: 'dir:/Users/fixture/Pods/delta', name: 'delta' })
  expect(view.systems.filter(system => system.kind === 'ssh')).toHaveLength(5)
  expect(view.systems.find(system => system.id === 'ai:jev')).toMatchObject({ kind: 'service', how: 'jev-1.13.0' })

  // Pods: kind, AI, shared data written and read, declared work, resources with secrets as aliases only.
  const classification = view.pods.find(pod => pod.id === f.pods['Mail-Klassifizierung'])!
  expect(classification).toMatchObject({ tags: { own: ['delta-mind'], revision: 1 }, lifecycle: 'active', kind: 'decision', ai: true, runs: 10, secrets: [], data: { writes: ['delta-mind/mail/classifications'], reads: ['delta-mind/mail/messages', 'delta-mind/mail/owner-answers'] } })
  expect(classification.work).toEqual({ pending: 0, held: 0 })
  expect(classification.resources).toEqual([{ kind: 'service', name: 'TypeSafe / Jev', how: 'jev-1.13.0 · 20', system: 'ai:jev' }, { kind: 'directory', name: 'delta', how: 'readWrite', system: 'dir:/Users/fixture/Pods/delta' }])
  const sync = view.pods.find(pod => pod.id === f.pods['Mail-Synchronisierung'])!
  expect(sync).toMatchObject({ kind: 'source', data: { writes: ['delta-mind/mail/messages'], reads: [] }, schedule: { spec: { kind: 'interval', seconds: 900 }, enabled: true }, lastRun: { state: 'completed', summary: 'Read 6 changed messages. No mailbox writes.' } })
  expect(sync.resources.find(resource => resource.kind === 'application')).toEqual({ kind: 'application', name: 'o365-cli', how: 'List emails in inbox for phofmann@delta-mind.at; Read email from account phofmann@delta-mind.at', system: 'app:o365-cli:phofmann@delta-mind.at' })
  const bot = view.pods.find(pod => pod.name === 'Morgenbriefing · Calendar-Bot')!
  expect(bot).toMatchObject({ kind: 'effect', ai: false, secrets: ['calendar_bot_token', 'reports_publisher_key'], schedule: null, data: { writes: ['patrick/briefing/publications'], reads: ['patrick/briefing/editions'] } })
  expect(bot).not.toHaveProperty('tags')
  expect(JSON.stringify(view)).not.toMatch(/credentialId|"value"/)
  const monitor = view.pods.find(pod => pod.name === 'IURIO PR monitor')!
  expect(monitor).toMatchObject({ tags: { own: ['iurio'], revision: 1 }, lastRun: { state: 'running' }, approvals: [{ grantId: 'grant-pr-monitor', title: 'Execution permission for IURIO PR monitor' }], schedule: { spec: { kind: 'interval', seconds: 900 }, enabled: true } })
  expect(view.pods.find(pod => pod.name === 'Daily action website')).toMatchObject({ draft: true, lifecycle: 'paused', kind: 'code' })
  expect(view.pods.find(pod => pod.name === 'Archived research')).toMatchObject({ lifecycle: 'archived' })

  // Edges: shared data from the writer to each reader with the records changed in the window; reads counted by runs,
  // writes by ledger entries; a mailbox read and written is one node with two edges.
  const edge = (from: string, to: string, type: string) => view.edges.find(item => item.from === from && item.to === to && item.type === type)
  expect(edge(f.pods['Mail-Synchronisierung']!, f.pods['Mail-Klassifizierung']!, 'data')).toEqual({ from: f.pods['Mail-Synchronisierung'], to: f.pods['Mail-Klassifizierung'], type: 'data', channel: 'delta-mind/mail/messages', flow: 20 })
  expect(edge(f.pods['Mail-Klassifizierung']!, f.pods['Rechnungsprüfung']!, 'data')).toMatchObject({ channel: 'delta-mind/mail/classifications', flow: 15 })
  expect(view.edges.filter(item => item.type === 'data' && item.channel === 'delta-mind/mail/owner-answers')).toEqual([])
  expect(edge('app:o365-cli:phofmann@delta-mind.at', f.pods['Mail-Synchronisierung']!, 'read')).toMatchObject({ flow: 10 })
  expect(edge(f.pods['Newsletter-Prüfung']!, 'app:o365-cli:phofmann@delta-mind.at', 'write')).toMatchObject({ flow: 0 })
  expect(edge('svc:https://zaz.delta-mind.at', view.pods.find(pod => pod.name === 'zaz Service-Agent')!.id, 'read')).toMatchObject({ flow: 150 })
  expect(edge(monitor.id, 'svc:https://api.telegram.org', 'write')).toMatchObject({ flow: 5 })
  expect(edge('svc:https://api.telegram.org', monitor.id, 'read')).toBeUndefined()

  // KPIs: Pods with a running schedule, the degraded monitor that is running again, open questions and approvals.
  expect(view.kpis).toEqual({
    active: 5, paused: 25,
    degraded: [{ podId: monitor.id, reason: 'completedWithGaps' }],
    decisions: [{ podId: f.pods['Mail-Klassifizierung'], kind: 'question', title: 'Mail-Klassifizierung', count: 17 }, { podId: f.pods['Newsletter-Prüfung'], kind: 'approval', title: 'Newsletter-Prüfung', count: 4 }],
    unknownDeliveries: 1,
  })
  expect(bot.unknown).toHaveLength(1)
  f.store.db.prepare('UPDATE effect_ledger SET state=\'unknown\' WHERE rowid=(SELECT max(rowid) FROM effect_ledger)').run()
  f.store.db.prepare('INSERT INTO accepted_events(id,pod_id,source,dedupe_key,payload,accepted_at,state,error) VALUES(?,?,\'schedule\',\'k\',\'{}\',?,\'blocked\',\'Execution permission requires owner review\')').run('event-blocked', monitor.id, NOW)
  f.store.db.prepare('INSERT INTO effect_attempts VALUES(?,1,?,NULL,\'mail.archive\',?,\'unknown\',\'{}\',1)').run('e'.repeat(64), f.pods['Newsletter-Prüfung'], 'f'.repeat(64))
  const later = mapView(f.store, NOW)
  expect(later.kpis.unknownDeliveries).toBe(3)
  expect(later.kpis.degraded).toEqual([{ podId: monitor.id, reason: 'Execution permission requires owner review' }])
  expect(later.pods.find(pod => pod.id === monitor.id)!.queue).toEqual({ blocked: 1, error: 'Execution permission requires owner review' })
})

it('keeps the rights, runs and systems of local-only Pods out of the published variant but shows their shared data', () => {
  const f = mapFixture()
  const view = parseMapView(mapView(f.store, NOW, true))
  const sync = view.pods.find(pod => pod.id === f.pods['Mail-Synchronisierung'])!
  expect(sync).toMatchObject({ resources: [], secrets: [], lastRun: null, runs: 0, approvals: [], queue: { blocked: 0, error: null }, data: { writes: ['delta-mind/mail/messages'], reads: [] }, schedule: { spec: { kind: 'interval', seconds: 900 }, enabled: true } })
  expect(view.edges.filter(edge => edge.type !== 'data' && (edge.from === sync.id || edge.to === sync.id))).toEqual([])
  expect(view.edges.find(edge => edge.from === sync.id && edge.channel === 'delta-mind/mail/messages')).toMatchObject({ flow: 20 })
  expect(view.systems.some(system => system.id === 'dir:/Users/fixture/Pods/delta')).toBe(false)
  expect(view.pods.find(pod => pod.name === 'IURIO PR monitor')!.resources.length).toBeGreaterThan(0)
  expect(view.kpis).toMatchObject({ active: 5, decisions: [expect.objectContaining({ count: 17 }), expect.objectContaining({ count: 4 })] })
})

it('reads the map through the workspace query without a Pod and keeps the other views unchanged', () => {
  const runtimeId = '00000000-0000-4000-8000-000000000138'
  expect(parseWorkspaceAction({ action: 'workspace', query: { type: 'read', runtimeId, view: 'map' } })).toEqual({ type: 'read', runtimeId, view: 'map' })
  expect(() => parseWorkspaceAction({ action: 'workspace', query: { type: 'read', runtimeId, view: 'map', podId: runtimeId } })).toThrow('Invalid workspace read view')
  expect(() => parseWorkspaceAction({ action: 'workspace', query: { type: 'read', runtimeId, view: 'summary' } })).toThrow('Invalid workspace identity')
  expect(() => parseMapView({ at: 1, window: { from: 0, to: 1 }, kpis: { active: 0, paused: 0, degraded: [], decisions: [], unknownDeliveries: 0 }, systems: [], pods: [], edges: [{ from: 'x', to: 'y', type: 'read', channel: null, flow: 1 }] })).toThrow('Invalid map edge')
})
