// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { closeNetworks, networkFixture } from './network-fixture'
import { NetworkEngine } from '../../src/worker/scheduling/network-engine'
import { WorkflowEngine } from '../../src/worker/workflows/engine'
import { previewNetworkConversion } from '../../src/worker/scheduling/network-migration'
import type { ConversionSelection } from '../../src/contracts/network-migration'
import { digest } from '../../src/worker/storage/database'
import { parseNetworkView } from '../../src/contracts/networks'
import { parseCentralNetworkRead, parseCentralNetworkResult } from '../../src/contracts/central-networks'
import { restoreNetworkStorage } from '../../src/worker/storage/network-restore'
import { pruneNetworkTraces } from '../../src/worker/scheduling/network-maintenance'
import { networkPublicationTables } from '../../src/worker/central/network-projection'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
afterEach(closeNetworks)
function fixture() {
  const f = networkFixture()
  const source = f.pod('Legacy source', { takes: [], gives: ['cases'], summary: 'Reads cases' }, async () => {})
  const consumer = f.pod('Legacy consumer', { takes: ['cases'], gives: [], summary: 'Reviews cases' }, async () => {})
  const workflowId = randomUUID()
  const legacy = new WorkflowEngine(f.store, { start: vi.fn(), cancelPod: vi.fn() }, { inspect: vi.fn() })
  legacy.save({ type: 'save', id: workflowId, revision: 0, name: 'Legacy cases', nodes: [source, consumer].map(podId => ({ podId, after: [], handoff: false })), schedule: null, enabled: false, mode: 'channels', groupId: f.groupId, channels: [{ name: 'cases', title: 'Cases', fields: ['subject'] }], gates: [], values: [] })
  const selection: ConversionSelection = {
    workflowId, revision: 1, pending: 'block', checkpoints: [{ podId: source, revision: 0, hash: digest('{}'), scriptHash: f.store.getPod(source).activeScript!, explicitSourceVersions: true }, { podId: consumer, revision: 0, hash: digest('{}'), scriptHash: f.store.getPod(consumer).activeScript!, explicitSourceVersions: false }],
    draft: { name: 'Converted cases', groupId: f.groupId, members: [{ podId: source, source: { schedule: null }, serialCase: false }, { podId: consumer, source: null, serialCase: false }], channels: [{ name: 'cases', title: 'Cases', schemaVersion: 1, schema: { type: 'object', properties: { subject: { type: 'string' } }, required: ['subject'], additionalProperties: false } }] },
  }
  const preview = () => previewNetworkConversion(f.store, f.resources, f.owner, selection)
  return { ...f, source, consumer, legacy, selection, preview }
}

it('previews conversion without any database or filesystem mutation and pins explicit checkpoints', () => {
  const f = fixture()
  const before = f.store.db.prepare('SELECT total_changes() AS count').get()!.count
  const files = readdirSync(f.store.root, { recursive: true })
  const result = f.preview()
  expect(result.issues).toEqual([])
  expect(result.members.map(member => member.podId).sort()).toEqual([f.source, f.consumer].sort())
  expect(result.candidate!.members.find(member => member.podId === f.source)!.source).not.toBeNull()
  expect(f.preview().fingerprint).toBe(result.fingerprint)
  expect(f.store.db.prepare('SELECT total_changes() AS count').get()!.count).toBe(before)
  expect(readdirSync(f.store.root, { recursive: true })).toEqual(files)
  f.selection.checkpoints = []
  expect(f.preview().issues.join(' ')).toContain('explicitly review the exact existing checkpoint')
})

it('refuses foreign ownership and changes the review fingerprint when local authority changes', () => {
  const f = fixture(); const before = f.preview().fingerprint
  f.store.db.prepare('INSERT INTO pod_variables VALUES(?,?,?,1)').run(f.source, 'recipientValue', 'local-only')
  expect(f.preview().fingerprint).not.toBe(before)
  expect(() => previewNetworkConversion(f.store, f.resources, { ...f.owner, subject: 'another-owner' }, f.selection)).toThrow('owner')
})

it('reports preparing approvals without changing legacy work', () => {
  const f = fixture()
  f.store.db.prepare('INSERT INTO graph_gate_batches VALUES(?,?,?,?,?,NULL,NULL,?,?,?,?,?,?,?)').run(randomUUID(), f.selection.workflowId, 'review', f.consumer, 'preparing', 'Synthetic pending review', digest('receipt'), 1, '[]', null, 1, 1)
  const before = f.store.db.prepare('SELECT * FROM graph_gate_batches').all()
  expect(f.preview().issues).toContain('Resolve every pending or uncertain legacy approval before conversion')
  expect(f.store.db.prepare('SELECT * FROM graph_gate_batches').all()).toEqual(before)
})

it('cuts over atomically with original instances, reviewed checkpoints and disabled old schedules', () => {
  const f = fixture()
  f.store.db.prepare('UPDATE checkpoints SET revision=3,body=? WHERE pod_id=?').run('{"cursor":"reviewed-watermark"}', f.source)
  f.selection.checkpoints[0] = { podId: f.source, revision: 3, hash: digest('{"cursor":"reviewed-watermark"}'), scriptHash: f.store.getPod(f.source).activeScript!, explicitSourceVersions: true }
  f.store.db.prepare('UPDATE checkpoints SET revision=2,body=? WHERE pod_id=?').run('{"reviewed":7}', f.consumer)
  f.selection.checkpoints[1] = { podId: f.consumer, revision: 2, hash: digest('{"reviewed":7}'), scriptHash: f.store.getPod(f.consumer).activeScript!, explicitSourceVersions: false }
  f.store.db.prepare('INSERT INTO schedules VALUES(?,1,?,1,1000,NULL)').run(f.source, '{"kind":"interval","seconds":60}')
  const pods = f.store.db.prepare('SELECT * FROM pods ORDER BY id').all()
  const scripts = f.store.db.prepare('SELECT * FROM scripts ORDER BY pod_id,hash').all()
  const checkpoints = f.store.db.prepare('SELECT * FROM checkpoints ORDER BY pod_id').all()
  const preview = f.preview()
  expect(preview.issues).toEqual([])
  const result = f.engine.convert(f.selection, preview.fingerprint)
  expect(f.store.db.prepare('SELECT * FROM pods ORDER BY id').all()).toEqual(pods)
  expect(f.store.db.prepare('SELECT * FROM scripts ORDER BY pod_id,hash').all()).toEqual(scripts)
  expect(f.store.db.prepare('SELECT * FROM checkpoints ORDER BY pod_id').all()).toEqual(checkpoints)
  expect(f.store.db.prepare('SELECT state,ancestor_workflow_id,ancestor_revision FROM networks').get()).toMatchObject({ state: 'paused', ancestor_workflow_id: f.selection.workflowId, ancestor_revision: 1 })
  expect(f.store.db.prepare('SELECT archived,enabled,paused FROM workflows').get()).toMatchObject({ archived: 1, enabled: 0, paused: 1 })
  expect(f.store.db.prepare('SELECT enabled,next_at FROM schedules WHERE pod_id=?').get(f.source)).toMatchObject({ enabled: 0, next_at: null })
  expect(f.store.db.prepare('SELECT revision,body FROM network_checkpoints WHERE pod_id=?').get(f.source)).toMatchObject({ revision: 3, body: '{"cursor":"reviewed-watermark"}' })
  expect(f.store.db.prepare('SELECT revision,body FROM network_checkpoints WHERE pod_id=?').get(f.consumer)).toMatchObject({ revision: 2, body: '{"reviewed":7}' })
  expect(f.engine.convert(f.selection, preview.fingerprint).createdId).toBe(result.createdId)
  expect(() => f.engine.convert(f.selection, digest('different review'))).toThrow('different reviewed conversion')
  expect(() => f.engine.convert({ ...f.selection, pending: 'retainLegacy' }, preview.fingerprint)).toThrow('different reviewed conversion')
  expect(f.store.db.prepare('SELECT count(*) AS count FROM networks').get()!.count).toBe(1)
  expect(f.started).toEqual([])
})

it('rejects stale conversion reviews and diagnoses invalid shared fields before cutover', () => {
  const f = fixture(); const old = f.preview()
  f.store.db.prepare('UPDATE pods SET name=? WHERE id=?').run('Changed source', f.source)
  expect(() => f.engine.convert(f.selection, old.fingerprint)).toThrow('review changed')
  expect(f.store.db.prepare('SELECT archived FROM workflows').get()!.archived).toBe(0)
  f.selection.draft.sharedValues = { undeclared: 'must not enter an incomplete network' }
  const current = f.preview()
  expect(current.issues).toContain('Shared network values require a declared public field')
  expect(() => f.engine.convert(f.selection, current.fingerprint)).toThrow('declared public field')
  expect(f.store.db.prepare('SELECT archived FROM workflows').get()!.archived).toBe(0)
  expect(f.store.db.prepare('SELECT count(*) AS count FROM workflow_members').get()!.count).toBe(2)
  expect(f.store.db.prepare('SELECT count(*) AS count FROM networks').get()!.count).toBe(0)
})

it('retains frozen conversion evidence through pruning and restore while keeping ancestors private', () => {
  const f = fixture(); const preview = f.preview()
  const id = f.engine.convert(f.selection, preview.fingerprint).createdId!
  const receipt = f.store.db.prepare('SELECT body FROM network_trace_events WHERE kind=\'legacy-conversion-reviewed\'').get()!.body
  expect(JSON.parse(receipt as string).legacy.id).toBe(f.selection.workflowId)
  expect(networkPublicationTables(f.store).workflows).toEqual([])
  pruneNetworkTraces(f.store, Date.now() + 10 * 86400000)
  f.store.transaction(() => restoreNetworkStorage(f.store.db))
  expect(f.store.db.prepare('SELECT body FROM network_trace_events WHERE kind=\'legacy-conversion-reviewed\'').get()!.body).toBe(receipt)
  expect(f.store.db.prepare('SELECT baseline_state FROM networks WHERE id=?').get(id)!.baseline_state).toBe('review_required')
  expect(f.engine.convert(f.selection, preview.fingerprint).createdId).toBe(id)
  expect(() => f.engine.execute({ type: 'activate', id, revision: 1 })).toThrow('reviewed baseline')
})

it('keeps conversion previews and commands on the desktop boundary', () => {
  const f = fixture()
  const command = { type: 'conversionPreview' as const, selection: f.selection }
  const preview = parseNetworkView(f.engine.execute(command)).conversion!
  expect(preview.fingerprint).toBe(f.preview().fingerprint)
  expect(() => parseCentralNetworkRead(command)).toThrow('local desktop')
  expect(() => parseCentralNetworkResult({ networks: [], conversion: preview })).toThrow('read-only')
  const result = parseNetworkView(f.engine.execute({ type: 'convert', selection: f.selection, expectedFingerprint: preview.fingerprint }))
  expect(result.createdId).toBeTruthy()
})

it('rolls back the original graph and schedules when a cutover write fails', () => {
  const f = fixture()
  f.store.db.prepare('INSERT INTO schedules VALUES(?,1,?,1,1000,NULL)').run(f.source, '{"kind":"interval","seconds":60}')
  const preview = f.preview()
  const schedules = f.store.db.prepare('SELECT * FROM schedules').all()
  f.store.db.exec('CREATE TEMP TRIGGER reject_conversion BEFORE INSERT ON network_trace_events WHEN NEW.kind=\'legacy-conversion-reviewed\' BEGIN SELECT RAISE(ABORT,\'Synthetic receipt write failure\'); END')
  expect(() => f.engine.convert(f.selection, preview.fingerprint)).toThrow('Synthetic receipt write failure')
  expect(f.store.db.prepare('SELECT * FROM schedules').all()).toEqual(schedules)
  expect(f.store.db.prepare('SELECT archived,revision FROM workflows').get()).toMatchObject({ archived: 0, revision: 1 })
  expect(f.store.db.prepare('SELECT count(*) AS count FROM workflow_members').get()!.count).toBe(2)
  expect(f.store.db.prepare('SELECT count(*) AS count FROM networks').get()!.count).toBe(0)
})

it('refuses a source with retained effect history even after its runs were pruned', () => {
  const f = fixture()
  f.store.db.prepare('INSERT INTO effect_ledger VALUES(?,?,?,?,NULL,?,?)').run(f.source, 'historical-item', 'http.request', digest('input'), 'completed', '{}')
  expect(f.preview().issues.join(' ')).toContain('historical source items have no checkpoint baseline')
  expect(f.store.db.prepare('SELECT count(*) AS count FROM runs').get()!.count).toBe(0)
})

it('refuses unfinished runs and unresolved recovery reviews even without a live lease', () => {
  const f = fixture(); const id = randomUUID()
  f.store.db.prepare('INSERT INTO runs VALUES(?,?,?,?,0,NULL,?,NULL,0,1)').run(id, f.consumer, f.store.getPod(f.consumer).activeScript!, 'running', 'Synthetic orphan')
  expect(f.preview().issues).toContain('Settle every unfinished member run before conversion')
  f.store.db.prepare('UPDATE runs SET state=?,finished_at=1 WHERE id=?').run('failed', id)
  expect(f.preview().issues).toContain('Resolve the latest unsuccessful member run before conversion')
  f.store.db.prepare('UPDATE runs SET state=? WHERE id=?').run('completed', id)
  f.store.db.prepare('INSERT INTO recovery_reviews VALUES(?,?,NULL,1,NULL)').run(id, 'ready')
  expect(f.preview().issues).toContain('Complete the member recovery review before conversion')
})

it('diagnoses stale setup and exhausted storage before any cutover', () => {
  const f = fixture()
  f.selection.draft.expectedSetup = digest('outdated setup')
  expect(f.preview().issues.join(' ')).toContain('Network setup changed')
  delete f.selection.draft.expectedSetup
  f.store.db.prepare('UPDATE data_settings SET limit_bytes=used_bytes+1 WHERE id=1').run()
  expect(f.preview().issues.join(' ')).toContain('Storage limit reached')
  expect(f.store.db.prepare('SELECT archived FROM workflows').get()!.archived).toBe(0)
})

it('retains explicitly selected legacy deliveries without replay even after network activation', async () => {
  const f = fixture(); const itemId = randomUUID()
  f.store.db.prepare('UPDATE checkpoints SET revision=1,body=? WHERE pod_id=?').run('{"cursor":"reviewed"}', f.source)
  f.selection.checkpoints[0] = { ...f.selection.checkpoints[0]!, revision: 1, hash: digest('{"cursor":"reviewed"}') }
  f.store.db.prepare('INSERT INTO graph_items VALUES(?,?,?,?,?,?,?,1)').run(itemId, f.selection.workflowId, randomUUID(), 'historical-item', 'cases', f.source, '{"subject":"Retained old item"}')
  f.store.db.prepare('INSERT INTO graph_deliveries VALUES(?,?,?,NULL,1)').run(itemId, f.consumer, 'pending')
  expect(f.preview().issues).toContain('Review retaining pending deliveries in the disabled legacy graph without replay')
  f.selection.pending = 'retainLegacy'
  const before = f.store.db.prepare('SELECT * FROM graph_deliveries').all()
  const preview = f.preview(); expect(preview.issues).toEqual([])
  const id = f.engine.convert(f.selection, preview.fingerprint).createdId!
  f.engine.execute({ type: 'activate', id, revision: 1 })
  await f.engine.tick()
  expect(f.store.db.prepare('SELECT * FROM graph_deliveries').all()).toEqual(before)
  const receipt = JSON.parse(f.store.db.prepare('SELECT body FROM network_trace_events WHERE kind=\'legacy-conversion-reviewed\'').get()!.body as string)
  expect(receipt.pending.items).toEqual([{ itemId, node: f.consumer, key: 'historical-item', payloadHash: digest('{"subject":"Retained old item"}') }])
  f.store.db.prepare('INSERT INTO graph_item_events(workflow_id,workflow_run_id,key,node,outcome,at) VALUES(?,?,?,?,?,1)').run(f.selection.workflowId, randomUUID(), 'historical-item', f.consumer, 'pending')
  const publication = networkPublicationTables(f.store)
  for (const table of ['graph_items', 'graph_deliveries', 'graph_item_events', 'workflow_values', 'checkpoints', 'pods']) expect(publication[table]).toEqual([])
  expect(f.store.db.prepare('SELECT count(*) AS count FROM network_deliveries').get()!.count).toBe(0)
  expect(f.started).toEqual([])
})

it('refuses pending standalone inputs, unknown effects and foreign runtime owners', () => {
  const f = fixture(); const run = randomUUID()
  f.store.db.prepare('INSERT INTO runs VALUES(?,?,?, ?,0,1,?,NULL,0,1)').run(run, f.consumer, f.store.getPod(f.consumer).activeScript!, 'completed', 'Synthetic historical action')
  f.store.db.prepare('INSERT INTO effect_ledger VALUES(?,?,?,?,?,?,NULL)').run(f.consumer, 'unknown', 'http.request', digest('input'), run, 'unknown')
  expect(f.preview().issues).toContain('Reconcile uncertain external effects before conversion')
  f.store.db.prepare('INSERT INTO accepted_events(id,pod_id,source,dedupe_key,payload,accepted_at) VALUES(?,?,?,?,?,1)').run(randomUUID(), f.consumer, 'synthetic', 'pending', '{}')
  expect(f.preview().issues).toContain('Resolve pending standalone inputs before conversion')
  f.store.db.prepare('INSERT INTO remote_pods VALUES(?,?,?,?,?,NULL,NULL)').run(f.source, JSON.stringify({ ...f.owner, subject: 'other-owner' }), randomUUID(), '1', 'ready')
  expect(() => f.preview()).toThrow('another owner')
})

it('preserves the string values used by unchanged legacy scripts and refuses conflicting overrides', async () => {
  const f = fixture()
  f.store.db.prepare('INSERT INTO workflow_values VALUES(?,?,?,1)').run(f.selection.workflowId, 'region', 'AT')
  const binding = f.store.db.prepare('SELECT definition_id,definition_version FROM instance_definition_bindings WHERE pod_id=?').get(f.source)!
  f.store.db.prepare('INSERT INTO definition_config VALUES(?,?,?,?,?)').run(binding.definition_id!, binding.definition_version!, 'region', 'public', '"AT"')
  f.selection.draft.sharedValues = { region: 'AT' }
  f.store.db.prepare('INSERT INTO instance_config VALUES(?,?,?)').run(f.source, 'region', '"DE"')
  expect(f.preview().issues.join(' ')).toContain('override conflicts')
  f.store.db.prepare('DELETE FROM instance_config WHERE pod_id=?').run(f.source)
  const preview = f.preview(); expect(preview.issues).toEqual([])
  const id = f.engine.convert(f.selection, preview.fingerprint).createdId!
  const observed: unknown[] = []
  f.behaviours.set(f.source, async (_items, _request, input) => { observed.push(input.variables) })
  f.process(id, [f.source], [], 1)
  await vi.waitFor(() => expect(observed).toEqual([{ region: 'AT' }]))
})

it('identifies legacy string-to-number changes before cutover and pins pending identities', () => {
  const f = fixture()
  f.store.db.prepare('INSERT INTO workflow_values VALUES(?,?,?,1)').run(f.selection.workflowId, 'limit', '42')
  expect(f.preview().issues).toContain('Declare each legacy graph value as a public string field in its Pod definitions before conversion')
  f.selection.draft.sharedValues = { limit: 42 }
  expect(f.preview().issues.join(' ')).toContain('Legacy graph values are strings')
  const before = f.preview().fingerprint
  f.store.db.prepare('INSERT INTO graph_items VALUES(?,?,?,?,?,?,?,1)').run(randomUUID(), f.selection.workflowId, randomUUID(), 'old', 'cases', f.source, '{}')
  const item = f.store.db.prepare('SELECT id FROM graph_items').get()!.id!
  f.store.db.prepare('INSERT INTO graph_deliveries VALUES(?,?,?,NULL,1)').run(item, f.consumer, 'pending')
  const pending = f.preview().fingerprint
  expect(pending).not.toBe(before)
  f.store.db.prepare('UPDATE graph_items SET payload=? WHERE id=?').run('{"changed":true}', item)
  expect(f.preview().fingerprint).not.toBe(pending)
})

it('reserves a standalone run before asynchronous preparation and refuses conversion while it settles', async () => {
  const f = fixture()
  let release!: () => void
  const capture = new Promise<void>((resolve) => { release = resolve })
  vi.mocked(f.resources.capture).mockImplementation(async () => { await capture; return { id: randomUUID(), files: [] } as never })
  const run = f.dispatcher.start(f.source)
  expect(f.store.db.prepare('SELECT run_id FROM run_leases WHERE pod_id=?').get(f.source)!.run_id).toBe(run)
  const preview = f.preview()
  expect(preview.issues).toContain('Wait for all member executions and reservations to settle')
  expect(() => f.engine.convert(f.selection, preview.fingerprint)).toThrow('settle')
  release()
  await f.dispatcher.stop()
  expect(f.store.db.prepare('SELECT archived FROM workflows').get()!.archived).toBe(0)
})

it('reviews terminal archival without mutation, preserves historical rows and refuses future execution', async () => {
  const f = fixture(); const id = f.engine.convert(f.selection, f.preview().fingerprint).createdId!
  const tables = ['pods', 'scripts', 'resources', 'checkpoints', 'network_members', 'network_checkpoints', 'network_revisions', 'workflows']
  const before = Object.fromEntries(tables.map(table => [table, f.store.db.prepare(`SELECT * FROM ${table}`).all()]))
  const changes = f.store.db.prepare('SELECT total_changes() AS n').get()!.n
  const review = parseNetworkView(f.engine.execute({ type: 'archivePreview', id, revision: 1 })).archiveReview!
  expect(review.issues).toEqual([])
  expect(f.store.db.prepare('SELECT total_changes() AS n').get()!.n).toBe(changes)
  const command = { type: 'archiveNetwork' as const, id, revision: 1, expectedFingerprint: review.fingerprint }
  expect(f.engine.execute(command).networks[0]!.state).toBe('archived')
  expect(f.engine.execute(command).networks[0]!.state).toBe('archived')
  for (const table of tables) expect(f.store.db.prepare(`SELECT * FROM ${table}`).all()).toEqual(before[table])
  for (const type of ['activate', 'pause'] as const) expect(() => f.engine.execute({ type, id, revision: 1 })).toThrow('unavailable')
  expect(() => f.engine.execute({ type: 'preview', id, revision: 1, podIds: [f.source], pausedPodIds: [], budget: 1 })).toThrow('unavailable')
  expect(f.engine.execute({ type: 'detail', id, revision: 1 }).details!.definition.id).toBe(id)
  pruneNetworkTraces(f.store, Date.now() + 10 * 86400000)
  f.store.transaction(() => restoreNetworkStorage(f.store.db))
  expect(f.engine.execute(command).networks[0]!.state).toBe('archived')
  await f.engine.tick(); expect(f.started).toEqual([])
})

it('refuses stale and active archive reviews and preserves unsettled effects', () => {
  const f = fixture(); const id = f.engine.convert(f.selection, f.preview().fingerprint).createdId!
  const review = f.engine.execute({ type: 'archivePreview', id, revision: 1 }).archiveReview!
  f.engine.execute({ type: 'activate', id, revision: 1 })
  expect(f.engine.execute({ type: 'archivePreview', id, revision: 1 }).archiveReview!.issues).toContain('Pause the network before reviewing archival')
  expect(() => f.engine.execute({ type: 'archiveNetwork', id, revision: 1, expectedFingerprint: review.fingerprint })).toThrow('review changed')
  f.engine.execute({ type: 'pause', id, revision: 1 })
  const runId = randomUUID()
  f.store.db.prepare('INSERT INTO runs VALUES(?,?,?,?,0,1,?,NULL,0,1)').run(runId, f.source, f.store.getPod(f.source).activeScript!, 'completed', 'Synthetic retained effect')
  f.store.db.prepare('INSERT INTO effect_ledger VALUES(?,?,?,?,?,?,NULL)').run(f.source, 'uncertain', 'http.request', digest('intent'), runId, 'unknown')
  const pending = f.engine.execute({ type: 'archivePreview', id, revision: 1 }).archiveReview!
  expect(pending.issues).toContain('Reconcile retained legacy effects before changing the composition')
  expect(() => f.engine.execute({ type: 'archiveNetwork', id, revision: 1, expectedFingerprint: pending.fingerprint })).toThrow('Reconcile')
  expect(f.engine.view().networks[0]!.state).toBe('paused')
  expect(f.store.db.prepare('SELECT state FROM effect_ledger').get()!.state).toBe('unknown')
})

it('pages exact retained delivery receipts without mutation or replay and detects changed payloads', () => {
  const f = fixture()
  f.store.db.prepare('UPDATE checkpoints SET revision=1,body=? WHERE pod_id=?').run('{"cursor":"reviewed"}', f.source)
  f.selection.checkpoints[0] = { ...f.selection.checkpoints[0]!, revision: 1, hash: digest('{"cursor":"reviewed"}') }
  for (let index = 0; index < 7; index++) {
    const itemId = randomUUID()
    f.store.db.prepare('INSERT INTO graph_items VALUES(?,?,?,?,?,?,?,1)').run(itemId, f.selection.workflowId, randomUUID(), `old-${index}`, 'cases', f.source, JSON.stringify({ subject: 'x'.repeat(17000) }))
    f.store.db.prepare('INSERT INTO graph_deliveries VALUES(?,?,?,NULL,1)').run(itemId, f.consumer, 'pending')
  }
  f.selection.pending = 'retainLegacy'
  const id = f.engine.convert(f.selection, f.preview().fingerprint).createdId!
  const changes = f.store.db.prepare('SELECT total_changes() AS n').get()!.n
  const first = parseNetworkView(f.engine.execute({ type: 'legacyItems', id, revision: 1, after: null })).legacyItems!
  expect(first.items).toHaveLength(5); expect(first.after).toBe(4)
  expect(first.items.every(item => item.truncated && item.payload!.length === 16384 && item.originalHash === item.currentHash)).toBe(true)
  const second = f.engine.execute({ type: 'legacyItems', id, revision: 1, after: first.after }).legacyItems!
  expect(second.items).toHaveLength(2); expect(second.after).toBeNull()
  expect(new Set([...first.items, ...second.items].map(item => item.itemId)).size).toBe(7)
  expect(f.store.db.prepare('SELECT total_changes() AS n').get()!.n).toBe(changes)
  f.store.db.prepare('UPDATE graph_items SET payload=? WHERE id=?').run('{}', first.items[0]!.itemId)
  const changed = f.engine.execute({ type: 'legacyItems', id, revision: 1, after: null }).legacyItems!.items[0]!
  expect(changed.currentHash).not.toBe(changed.originalHash)
  f.store.db.prepare('DELETE FROM graph_deliveries WHERE item_id=?').run(changed.itemId)
  f.store.db.prepare('DELETE FROM graph_items WHERE id=?').run(changed.itemId)
  expect(f.engine.execute({ type: 'legacyItems', id, revision: 1, after: null }).legacyItems!.items[0]).toMatchObject({ itemId: changed.itemId, payload: null, currentHash: null, state: 'missing' })
  const foreign = new NetworkEngine(f.store, f.dispatcher, f.resources, '/unused', () => ({ ...f.owner, subject: 'foreign' }))
  for (const command of [{ type: 'legacyItems', id, revision: 1, after: null }, { type: 'archivePreview', id, revision: 1 }, { type: 'archiveNetwork', id, revision: 1, expectedFingerprint: digest('foreign') }]) expect(() => foreign.execute(command)).toThrow('owner')
  expect(() => parseCentralNetworkRead({ type: 'legacyItems', id, revision: 1, after: null })).toThrow('local desktop')
  expect(() => parseCentralNetworkResult({ networks: [], legacyItems: first })).toThrow('read-only')
  expect(f.store.db.prepare('SELECT count(*) AS n FROM network_deliveries').get()!.n).toBe(0)
})

it('refuses archival while native leases, bounded batches, invocations, deliveries, joins or effect receipts remain unresolved', async () => {
  const f = fixture(); const id = f.engine.convert(f.selection, f.preview().fingerprint).createdId!
  const issues = () => f.engine.execute({ type: 'archivePreview', id, revision: 1 }).archiveReview!.issues
  f.store.db.prepare('INSERT INTO program_leases VALUES(?,?,?,1,1)').run(f.source, randomUUID(), 'synthetic')
  expect(issues()).toContain('Wait for member program leases to settle')
  f.store.db.prepare('DELETE FROM program_leases').run()
  const preview = f.engine.execute({ type: 'preview', id, revision: 1, podIds: [f.source], pausedPodIds: [], budget: 1 }).preview!
  f.store.db.prepare('UPDATE network_process_previews SET state=\'running\',consumed_at=1 WHERE id=?').run(preview.id)
  expect(issues()).toContain('Stop bounded processing before changing the composition')
  f.store.db.prepare('UPDATE network_process_previews SET state=\'stopped\' WHERE id=?').run(preview.id)
  f.engine.execute({ type: 'activate', id, revision: 1 })
  const source = f.engine.invocations.reserve(id, f.source, f.resources.epoch(f.source), 'manual')!
  expect(issues()).toContain('Settle network executions before changing the composition')
  expect(issues()).toContain('Wait for member process leases to settle')
  await f.engine.invocations.finish(source, 'completed', 'Synthetic source', null, [], [{ channel: 'cases', key: 'case', sourceItemId: 'case', sourceVersion: '1', payload: { subject: 'Retained case' } }])
  expect(issues()).toContain('Resolve pending network deliveries before changing the composition')
  const consumer = f.engine.invocations.reserve(id, f.consumer, f.resources.epoch(f.consumer), 'manual')!
  const event = f.store.db.prepare('SELECT id,case_id,case_revision FROM network_events').get()!
  const effectKey = digest('synthetic-action')
  f.store.db.prepare('INSERT INTO network_effect_attempts VALUES(?,1,?,?,1,?,?,\'confirmed_applied\',1,?)').run(effectKey, consumer.runId, event.case_id!, digest('input'), digest('manifest'), id)
  expect(issues()).toContain('Reconcile external effect receipts before changing the composition')
  f.store.db.prepare('INSERT INTO network_effect_receipts VALUES(?,1,1,\'confirmed_applied\',?,1)').run(effectKey, '{"synthetic":true}')
  expect(issues()).not.toContain('Reconcile external effect receipts before changing the composition')
  f.store.db.prepare('INSERT INTO network_joins VALUES(?,?,?,?,1,?,1,\'blocked\',?)').run(id, 'synthetic-join', event.case_id!, event.case_revision!, '{}', 'Synthetic unresolved join')
  expect(issues()).toContain('Resolve pending joins before changing the composition')
  f.store.db.prepare('UPDATE network_joins SET state=\'discarded\',reason=? WHERE network_id=?').run('Synthetic explicit resolution', id)
  await f.engine.invocations.finish(consumer, 'completed', 'Synthetic consumer', null, [event.id as string], [])
  f.engine.execute({ type: 'pause', id, revision: 1 })
  expect(issues()).toEqual([])
  const archived = f.engine.execute({ type: 'archivePreview', id, revision: 1 }).archiveReview!
  f.engine.execute({ type: 'archiveNetwork', id, revision: 1, expectedFingerprint: archived.fingerprint })
  expect(() => f.engine.execute({ type: 'archiveNetwork', id, revision: 1, expectedFingerprint: digest('different') })).toThrow('different archive review')
  expect(() => f.engine.updateInstance(f.source, () => { throw new Error('Must not execute') })).toThrow('Archived')
  expect(() => f.engine.execute({ type: 'process', id, revision: 1, previewId: preview.id })).toThrow('unavailable')
  expect(f.store.db.prepare('SELECT count(*) AS n FROM network_effect_receipts').get()!.n).toBe(1)
})

it('replaces a settled paused composition with fresh additions and preserves historical members and checkpoints', () => {
  const f = fixture(); const id = f.engine.convert(f.selection, f.preview().fingerprint).createdId!
  const nextConsumer = f.pod('Fresh reviewer', { takes: ['cases'], gives: [], summary: 'Replacement reviewer' }, async () => {})
  const setup = parseNetworkView(f.engine.execute({ type: 'replacementSetup', id, revision: 1 })).replacement!
  expect(setup.issues).toEqual([])
  const draft = { ...setup.draft, name: 'Reviewed replacement', members: setup.draft.members.map(member => member.podId === f.consumer ? { ...member, podId: nextConsumer } : member) }
  const changes = f.store.db.prepare('SELECT total_changes() AS n').get()!.n
  const review = parseNetworkView(f.engine.execute({ type: 'replacementPreview', id, revision: 1, draft })).replacement!
  expect(review.issues).toEqual([])
  expect(review.added).toEqual([nextConsumer]); expect(review.retired).toEqual([f.consumer])
  expect(f.store.db.prepare('SELECT total_changes() AS n').get()!.n).toBe(changes)
  const preserved = ['pods', 'scripts', 'resources', 'checkpoints', 'network_checkpoints', 'network_members', 'network_subscriptions'].map(table => ({ table, rows: f.store.db.prepare(`SELECT * FROM ${table}`).all() }))
  const command = { type: 'replaceComposition' as const, id, revision: 1, draft, expectedFingerprint: review.fingerprint }
  expect(f.engine.execute(command).networks[0]).toMatchObject({ id, revision: 2, state: 'paused', name: 'Reviewed replacement' })
  expect(f.engine.execute(command).networks[0]!.revision).toBe(2)
  for (const { table, rows } of preserved) expect(f.store.db.prepare(`SELECT * FROM ${table}`).all()).toEqual(expect.arrayContaining(rows))
  const next = f.engine.execute({ type: 'detail', id, revision: 2 }).details!.definition
  expect(next.members.map(member => member.podId)).toEqual(draft.members.map(member => member.podId))
  expect(next.members.find(member => member.podId === f.source)!.source!.bindingId).toBe(setup.current.members.find(member => member.podId === f.source)!.source!.bindingId)
  expect(f.store.db.prepare('SELECT count(*) AS n FROM network_revisions WHERE network_id=?').get(id)!.n).toBe(2)
  expect(() => f.engine.updateInstance(f.consumer, () => { throw new Error('Must not update retired history') })).toThrow('Retired')
  expect(f.started).toEqual([])
  f.store.assertStorage()
})

it('refuses stale, active, historical-member and incompatible-schema replacements without mutation', () => {
  const f = fixture(); const id = f.engine.convert(f.selection, f.preview().fingerprint).createdId!
  const setup = f.engine.execute({ type: 'replacementSetup', id, revision: 1 }).replacement!
  const draft = { ...setup.draft, name: 'Reviewed name' }
  const review = f.engine.execute({ type: 'replacementPreview', id, revision: 1, draft }).replacement!
  f.engine.execute({ type: 'activate', id, revision: 1 })
  expect(() => f.engine.execute({ type: 'replaceComposition', id, revision: 1, draft, expectedFingerprint: review.fingerprint })).toThrow('review changed')
  expect(f.engine.execute({ type: 'replacementPreview', id, revision: 1, draft }).replacement!.issues).toContain('Pause the network before replacing its composition')
  f.engine.execute({ type: 'pause', id, revision: 1 })
  const changedSchema = { ...draft, channels: draft.channels.map(channel => ({ ...channel, schema: { ...channel.schema, properties: { subject: { type: 'number' as const } } } })) }
  expect(f.engine.execute({ type: 'replacementPreview', id, revision: 1, draft: changedSchema }).replacement!.issues).toContain('Changed channel schemas require a new version; historical versions cannot be reused')
  const fresh = f.pod('Used instance', { takes: ['cases'], gives: [], summary: 'Used member' }, async () => {})
  f.store.db.prepare('UPDATE checkpoints SET revision=1 WHERE pod_id=?').run(fresh)
  const usedDraft = { ...draft, members: [...draft.members, { podId: fresh, source: null, serialCase: false }] }
  expect(f.engine.execute({ type: 'replacementPreview', id, revision: 1, draft: usedDraft }).replacement!.issues).toContain('Added members must be separate fresh instances; historical members remain reserved')
  expect(f.engine.view().networks[0]!.revision).toBe(1)
  expect(() => parseCentralNetworkRead({ type: 'replacementSetup', id, revision: 1 })).toThrow('local desktop')
  expect(() => parseCentralNetworkResult({ networks: [], replacement: setup })).toThrow('read-only')
})

it('retains source deduplication across replacement and routes only new versions to fresh subscriptions', async () => {
  const f = fixture(); const id = f.engine.convert(f.selection, f.preview().fingerprint).createdId!
  f.engine.execute({ type: 'activate', id, revision: 1 })
  const source = f.engine.invocations.reserve(id, f.source, f.resources.epoch(f.source), 'manual')!
  const emission = { channel: 'cases', key: 'case', sourceItemId: 'case', sourceVersion: '1', payload: { subject: 'Preserved case' } }
  await f.engine.invocations.finish(source, 'completed', 'Initial source', null, [], [emission])
  const event = f.store.db.prepare('SELECT id FROM network_events').get()!.id as string
  const consumer = f.engine.invocations.reserve(id, f.consumer, f.resources.epoch(f.consumer), 'manual')!
  await f.engine.invocations.finish(consumer, 'completed', 'Initial consumer', null, [event], [])
  f.engine.execute({ type: 'pause', id, revision: 1 })
  const fresh = f.pod('New reviewer', { takes: ['cases'], gives: [], summary: 'New reviewer' }, async () => {})
  const setup = f.engine.execute({ type: 'replacementSetup', id, revision: 1 }).replacement!
  const draft = { ...setup.draft, members: setup.draft.members.map(member => member.podId === f.consumer ? { ...member, podId: fresh } : member) }
  const review = f.engine.execute({ type: 'replacementPreview', id, revision: 1, draft }).replacement!
  expect(review.issues).toEqual([])
  f.engine.execute({ type: 'replaceComposition', id, revision: 1, draft, expectedFingerprint: review.fingerprint })
  f.engine.execute({ type: 'activate', id, revision: 2 })
  const repeated = f.engine.invocations.reserve(id, f.source, f.resources.epoch(f.source), 'manual')!
  await f.engine.invocations.finish(repeated, 'completed', 'Same source version', null, [], [emission])
  expect(f.store.db.prepare('SELECT count(*) AS n FROM network_events').get()!.n).toBe(1)
  expect(f.store.db.prepare('SELECT count(*) AS n FROM network_deliveries').get()!.n).toBe(1)
  const newer = f.engine.invocations.reserve(id, f.source, f.resources.epoch(f.source), 'manual')!
  await f.engine.invocations.finish(newer, 'completed', 'New explicit source version', null, [], [{ ...emission, sourceVersion: '2' }])
  expect(f.store.db.prepare('SELECT s.pod_id FROM network_deliveries d JOIN network_subscriptions s ON s.id=d.subscription_id WHERE d.state=\'pending\'').all()).toEqual([{ pod_id: fresh }])
  expect(() => f.engine.invocations.reserve(id, f.consumer, f.resources.epoch(f.consumer), 'manual')).toThrow('Pod is not a member of this network revision')
  f.store.assertStorage()
})

it('retires a broken member without weakening validation of members that remain', () => {
  const f = fixture(); const id = f.engine.convert(f.selection, f.preview().fingerprint).createdId!
  const fresh = f.pod('Fresh reviewer', { takes: ['cases'], gives: [], summary: 'Replacement reviewer' }, async () => {})
  f.store.db.prepare('DELETE FROM validations WHERE pod_id=?').run(f.consumer)
  const setup = f.engine.execute({ type: 'replacementSetup', id, revision: 1 }).replacement!
  expect(setup.issues.length).toBeGreaterThan(0)
  const draft = { ...setup.draft, members: setup.draft.members.map(member => member.podId === f.consumer ? { ...member, podId: fresh } : member) }
  const review = f.engine.execute({ type: 'replacementPreview', id, revision: 1, draft }).replacement!
  expect(review.issues).toEqual([])
  f.engine.execute({ type: 'replaceComposition', id, revision: 1, draft, expectedFingerprint: review.fingerprint })
  expect(f.engine.execute({ type: 'detail', id, revision: 2 }).details!.definition.members.map(member => member.podId)).toEqual([f.source, fresh])
  f.store.assertStorage()
  f.store.transaction(() => restoreNetworkStorage(f.store.db))
  expect(f.engine.view().networks[0]!.state).toBe('paused')
})

it('rolls back every replacement write on receipt failure and keeps retries valid after retention and restore', () => {
  const f = fixture(); const id = f.engine.convert(f.selection, f.preview().fingerprint).createdId!
  const setup = f.engine.execute({ type: 'replacementSetup', id, revision: 1 }).replacement!
  const draft = { ...setup.draft, name: 'Reviewed name' }
  const review = f.engine.execute({ type: 'replacementPreview', id, revision: 1, draft }).replacement!
  const command = { type: 'replaceComposition' as const, id, revision: 1, draft, expectedFingerprint: review.fingerprint }
  const tables = ['networks', 'network_revisions', 'network_members', 'network_checkpoints', 'network_subscriptions', 'composition_config', 'network_trace_events']
  const before = tables.map(table => f.store.db.prepare(`SELECT * FROM ${table}`).all())
  f.store.db.exec('CREATE TEMP TRIGGER reject_replacement BEFORE INSERT ON network_trace_events WHEN NEW.kind=\'composition-replaced-reviewed\' BEGIN SELECT RAISE(ABORT,\'Synthetic receipt failure\'); END')
  expect(() => f.engine.execute(command)).toThrow('Synthetic receipt failure')
  expect(tables.map(table => f.store.db.prepare(`SELECT * FROM ${table}`).all())).toEqual(before)
  f.store.db.exec('DROP TRIGGER reject_replacement')
  f.engine.execute(command)
  const receipt = f.store.db.prepare('SELECT body FROM network_trace_events WHERE kind=\'composition-replaced-reviewed\'').get()!.body
  pruneNetworkTraces(f.store, Date.now() + 100 * 86400000)
  f.store.transaction(() => restoreNetworkStorage(f.store.db))
  expect(f.store.db.prepare('SELECT body FROM network_trace_events WHERE kind=\'composition-replaced-reviewed\'').get()!.body).toBe(receipt)
  expect(f.engine.execute(command).networks[0]).toMatchObject({ revision: 2, state: 'paused' })
  expect(() => f.engine.execute({ ...command, draft: { ...draft, name: 'Unreviewed retry' } })).toThrow()
  expect(f.store.db.prepare('SELECT count(*) AS n FROM network_revisions').get()!.n).toBe(2)
})

it('requires a fresh instance for role changes and refuses reusing retired member identities', () => {
  const f = fixture(); const id = f.engine.convert(f.selection, f.preview().fingerprint).createdId!
  const setup = f.engine.execute({ type: 'replacementSetup', id, revision: 1 }).replacement!
  const changed = { ...setup.draft, members: setup.draft.members.map(member => ({ ...member, source: member.source ? null : { schedule: null } })) }
  const roleReview = f.engine.execute({ type: 'replacementPreview', id, revision: 1, draft: changed }).replacement!
  expect(roleReview.issues).toContain('Changing a source or consumer role requires a fresh instance')
  expect(() => f.engine.execute({ type: 'replaceComposition', id, revision: 1, draft: changed, expectedFingerprint: roleReview.fingerprint })).toThrow('fresh instance')
  const fresh = f.pod('Fresh reviewer', { takes: ['cases'], gives: [], summary: 'Replacement reviewer' }, async () => {})
  const draft = { ...setup.draft, members: setup.draft.members.map(member => member.podId === f.consumer ? { ...member, podId: fresh } : member) }
  const review = f.engine.execute({ type: 'replacementPreview', id, revision: 1, draft }).replacement!
  f.engine.execute({ type: 'replaceComposition', id, revision: 1, draft, expectedFingerprint: review.fingerprint })
  const historical = f.engine.execute({ type: 'replacementPreview', id, revision: 2, draft: setup.draft }).replacement!
  expect(historical.issues).toContain('Added members must be separate fresh instances; historical members remain reserved')
  expect(() => f.engine.execute({ type: 'replaceComposition', id, revision: 2, draft: setup.draft, expectedFingerprint: historical.fingerprint })).toThrow('historical members remain reserved')
  expect(f.engine.view().networks[0]!.revision).toBe(2)
})

it('refuses fresh-looking instances with retained external effects even when run history is gone', () => {
  const f = fixture(); const id = f.engine.convert(f.selection, f.preview().fingerprint).createdId!
  const fresh = f.pod('Historical effect owner', { takes: ['cases'], gives: [], summary: 'Not fresh' }, async () => {})
  f.store.db.prepare('INSERT INTO effect_ledger VALUES(?,?,?,?,NULL,?,?)').run(fresh, 'historical-item', 'http.request', digest('input'), 'completed', '{}')
  const setup = f.engine.execute({ type: 'replacementSetup', id, revision: 1 }).replacement!
  const draft = { ...setup.draft, members: setup.draft.members.map(member => member.podId === f.consumer ? { ...member, podId: fresh } : member) }
  const review = f.engine.execute({ type: 'replacementPreview', id, revision: 1, draft }).replacement!
  expect(review.issues).toContain('Added members must be separate fresh instances; historical members remain reserved')
  expect(() => f.engine.execute({ type: 'replaceComposition', id, revision: 1, draft, expectedFingerprint: review.fingerprint })).toThrow('fresh instances')
  expect(f.engine.view().networks[0]!.revision).toBe(1)
})
