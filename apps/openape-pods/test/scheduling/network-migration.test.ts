// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { readdirSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { closeNetworks, networkFixture } from './network-fixture'
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
