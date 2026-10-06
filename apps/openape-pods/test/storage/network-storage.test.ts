import { ResourceRegistry } from '../../src/worker/resources/registry'
import { RunDispatcher } from '../../src/worker/runs/dispatcher'
import type { AgentRuntime } from '../../src/worker/agent/executor'
import { Scheduler } from '../../src/worker/scheduling/scheduler'
import { WorkflowEngine } from '../../src/worker/workflows/engine'
import { PodGroups } from '../../src/worker/workspace/groups'
// @vitest-environment node
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { PodDatabase, schemaVersion } from '../../src/worker/storage/database'
import { assertNetworkStorage, networkTables } from '../../src/worker/storage/network-schema'
import { removeNetworkControls, removeNetworkSchema } from './legacy'
import { seedNetwork } from './network-fixture'

const roots: string[] = []; const stores: PodDatabase[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pods-network-storage-')); roots.push(root)
  const store = new PodDatabase(root); stores.push(store); return store
}
function reopen(store: PodDatabase) {
  store.close(); stores.splice(stores.indexOf(store), 1)
  const opened = new PodDatabase(store.root); stores.push(opened); return opened
}

it('adds empty network storage to schema 27 without converting any legacy identity or graph', () => {
  let store = fixture(); const pod = store.createPod({ name: 'Original identity' })
  store.db.prepare('INSERT INTO workflows(id,revision,name,nodes,mode) VALUES(\'legacy\',7,\'Original bounded graph\',\'[]\',\'channels\')').run()
  store.db.prepare('INSERT INTO graph_items VALUES(\'item\',\'legacy\',\'run\',\'source\',\'input\',\'node\',\'{}\',1)').run()
  removeNetworkSchema(store.db); store.db.exec('PRAGMA user_version=27')
  const before = { pods: store.db.prepare('SELECT * FROM pods').all(), workflows: store.db.prepare('SELECT * FROM workflows').all(), items: store.db.prepare('SELECT * FROM graph_items').all() }
  store = reopen(store)
  expect(store.db.prepare('PRAGMA user_version').get()?.user_version).toBe(schemaVersion)
  expect(store.getPod(pod.id).name).toBe('Original identity')
  expect({ pods: store.db.prepare('SELECT * FROM pods').all(), workflows: store.db.prepare('SELECT * FROM workflows').all(), items: store.db.prepare('SELECT * FROM graph_items').all() }).toEqual(before)
  for (const table of networkTables) expect(store.db.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count, table).toBe(0)
})

it('persists separate bindings and durable receipts with restrictive ownership and version constraints', () => {
  let store = fixture(); const f = seedNetwork(store)
  expect(() => store.db.prepare('INSERT INTO network_members VALUES(?,?,1,?,1,NULL)').run(f.networkId, f.pod.id, f.definitionId)).toThrow('UNIQUE')
  expect(() => store.db.prepare('DELETE FROM pod_groups WHERE id=?').run(f.groupId)).toThrow('FOREIGN KEY')
  expect(() => store.db.prepare('DELETE FROM pods WHERE id=?').run(f.pod.id)).toThrow('FOREIGN KEY')
  expect(() => store.db.prepare('UPDATE network_deliveries SET state=\'claimed\' WHERE id=?').run(f.deliveryId)).toThrow('CHECK')
  store = reopen(store)
  expect(store.db.prepare('SELECT restore_nonce,state FROM networks').get()).toEqual({ restore_nonce: f.restoreNonce, state: 'paused' })
  expect(store.db.prepare('SELECT body FROM network_checkpoints').get()?.body).toBe('{"cursor":"retained"}')
  expect(store.db.prepare('SELECT event_id FROM network_event_identities').get()?.event_id).toBe(f.eventId)
})

it('rejects a partial schema without quietly creating missing authoritative tables', () => {
  const store = fixture(); store.db.exec('DROP TABLE network_trace_events'); store.close(); stores.splice(stores.indexOf(store), 1)
  expect(() => new PodDatabase(store.root)).toThrow('Incomplete or altered network storage')
})

it('rejects cross-owner collection permission without changing an existing permission', () => {
  const store = fixture(); const f = seedNetwork(store)
  store.transaction(() => {
    store.db.prepare('INSERT INTO network_owners VALUES(?,?)').run(f.owner.issuer, 'other-owner')
    store.db.prepare('INSERT INTO data_collections VALUES(?,?,?,?,?,1,?)').run('collection', f.owner.issuer, 'other-owner', f.groupId, 'Private collection', '{}')
    store.db.prepare('INSERT INTO data_collection_versions VALUES(?,1,?,?,1)').run('collection', '{}', '[]')
  })
  expect(() => store.db.prepare('INSERT INTO data_permissions VALUES(?,?,?,?,?,?,?,1)').run(f.networkId, f.pod.id, 'collection', f.owner.issuer, f.owner.subject, f.groupId, 'read')).toThrow('FOREIGN KEY')
  expect(store.db.prepare('SELECT * FROM data_permissions').all()).toEqual([])
})

it('refuses changing company or removing a bound company without mutating membership', () => {
  const store = fixture(); const f = seedNetwork(store); const groups = new PodGroups(store)
  const before = groups.view()
  expect(() => groups.execute({ type: 'organize', action: 'move', revision: before.revision, podId: f.pod.id, groupId: null })).toThrow('review rebinding')
  expect(() => groups.execute({ type: 'organize', action: 'remove', revision: before.revision, id: f.groupId })).toThrow('review bindings')
  expect(groups.view()).toEqual(before)
})

it('rolls back an interrupted additive migration and keeps its schema-27 rollback copy', () => {
  const store = fixture(); const pod = store.createPod({ name: 'Original identity' })
  removeNetworkSchema(store.db)
  store.db.exec('CREATE TABLE network_trace_events(id TEXT PRIMARY KEY); PRAGMA user_version=27;')
  const original = store.db.prepare('SELECT * FROM pods').all()
  store.close(); stores.splice(stores.indexOf(store), 1)
  expect(() => new PodDatabase(store.root)).toThrow('already exists')
  const database = new DatabaseSync(join(store.root, 'control.sqlite'), { readOnly: true })
  try {
    expect(database.prepare('PRAGMA user_version').get()?.user_version).toBe(27)
    expect(database.prepare('SELECT * FROM pods').all()).toEqual(original)
    expect(database.prepare('SELECT name FROM sqlite_schema WHERE name IN (\'networks\',\'network_owners\',\'network_events\')').all()).toEqual([])
    expect(database.prepare('SELECT id FROM pods').get()?.id).toBe(pod.id)
  }
  finally { database.close() }
  const backup = readdirSync(store.root).find(name => name.startsWith('before-v27-'))!
  const rollback = new DatabaseSync(join(store.root, backup), { readOnly: true })
  try { expect(rollback.prepare('PRAGMA user_version').get()?.user_version).toBe(27); expect(rollback.prepare('SELECT * FROM pods').all()).toEqual(original) }
  finally { rollback.close() }
})

it('rejects effect authority crossing a network even when both networks exist', () => {
  const store = fixture(); const f = seedNetwork(store); const other = randomUUID()
  store.transaction(() => {
    store.db.prepare('INSERT INTO networks(id,owner_issuer,owner_subject,group_id,name,revision,restore_nonce,created_at) VALUES(?,?,?,?,?,1,?,1)').run(other, f.owner.issuer, f.owner.subject, f.groupId, 'Another network', randomUUID())
    store.db.prepare('INSERT INTO network_revisions VALUES(?,1,?,?,1)').run(other, '{}', '0'.repeat(64))
  })
  expect(() => store.db.prepare('UPDATE network_effect_attempts SET network_id=?').run(other)).toThrow('FOREIGN KEY')
  expect(store.db.prepare('SELECT network_id FROM network_effect_attempts').get()?.network_id).toBe(f.networkId)
})

it('refuses direct legacy dispatch, intake and workflow membership without reserving a network instance', () => {
  const store = fixture(); const resources = new ResourceRegistry(store, () => {})
  const dispatcher = new RunDispatcher(store, resources, {} as AgentRuntime)
  const f = seedNetwork(store); const beforeRuns = store.db.prepare('SELECT * FROM runs').all()
  const scheduler = new Scheduler(store, dispatcher)
  const engine = new WorkflowEngine(store, dispatcher, { inspect: async () => {} })
  expect(() => dispatcher.start(f.pod.id)).toThrow('Network instances require')
  expect(() => scheduler.requestManual(f.pod.id)).toThrow('Network instances require')
  expect(() => scheduler.acceptEvent(f.pod.id, 'manual', 'source', {})).toThrow('Network instances require')
  expect(() => engine.save({ type: 'save', id: randomUUID(), revision: 0, name: 'Legacy workflow', nodes: [{ podId: f.pod.id, after: [], handoff: false }], schedule: null, enabled: false })).toThrow('Network instances cannot join')
  expect(store.db.prepare('SELECT * FROM runs').all()).toEqual(beforeRuns)
  expect(store.db.prepare('SELECT * FROM run_leases').all()).toEqual([])
  expect(store.db.prepare('SELECT * FROM accepted_events').all()).toEqual([])
  expect(store.db.prepare('SELECT * FROM workflow_members').all()).toEqual([])
})

it('migrates schema-28 operational authority without changing legacy pins or replaying consumed previews', () => {
  let store = fixture(); const f = seedNetwork(store)
  removeNetworkControls(store.db)
  store.db.exec('PRAGMA user_version=28')
  const previewId = randomUUID(); const fingerprint = 'a'.repeat(64)
  const activation = store.db.prepare('INSERT INTO network_trace_events(network_id,kind,body,created_at) VALUES(?,?,?,1)').run(f.networkId, 'network-activated', JSON.stringify({ sources: [{ podId: f.pod.id, nextAt: 100 }] })).lastInsertRowid
  store.db.prepare('UPDATE network_invocations SET manifest=? WHERE run_id=?').run(JSON.stringify({ sourceActivationId: Number(activation), sourceNextAt: 200, reason: 'schedule', reviewRequired: true, snapshots: { id: 'retained-snapshot', files: [] } }), f.runId)
  const preview = { id: previewId, networkId: f.networkId, revision: 1, podIds: [f.pod.id], pausedPodIds: [], sources: [f.pod.id], consumers: [], budget: 2, expiresAt: 9999999999999 }
  store.db.prepare('INSERT INTO network_trace_events(network_id,kind,body,created_at) VALUES(?,?,?,2)').run(f.networkId, 'process-now-preview', JSON.stringify({ preview, fingerprint }))
  store.db.prepare('INSERT INTO network_trace_events(network_id,kind,body,created_at) VALUES(?,?,?,3)').run(f.networkId, 'process-now-started', JSON.stringify({ previewId }))
  const pins = store.db.prepare('SELECT * FROM network_invocations').all()
  assertNetworkStorage(store.db, true)
  store = reopen(store)
  expect(store.db.prepare('SELECT * FROM network_invocations').all()).toEqual(pins)
  expect(store.db.prepare('SELECT next_at FROM network_source_clocks').get()?.next_at).toBe(200)
  expect(store.db.prepare('SELECT review_required,snapshots FROM network_invocation_controls').get()).toEqual({ review_required: 1, snapshots: '{"id":"retained-snapshot","files":[]}' })
  expect(store.db.prepare('SELECT state,consumed_at FROM network_process_previews').get()).toEqual({ state: 'stopped', consumed_at: 3 })
  store.db.prepare('DELETE FROM network_trace_events').run()
  store = reopen(store)
  expect(store.db.prepare('SELECT next_at FROM network_source_clocks').get()?.next_at).toBe(200)
  expect(store.db.prepare('SELECT consumed_at FROM network_process_previews').get()?.consumed_at).toBe(3)
})

it('invalidates unconsumed schema-28 previews and clocks after an owner restore', () => {
  let store = fixture(); const f = seedNetwork(store)
  removeNetworkControls(store.db); store.db.exec('PRAGMA user_version=28')
  store.db.prepare('UPDATE networks SET baseline_state=\'review_required\' WHERE id=?').run(f.networkId)
  const preview = { id: randomUUID(), networkId: f.networkId, budget: 2, expiresAt: 9999999999999 }
  store.db.prepare('INSERT INTO network_trace_events(network_id,kind,body,created_at) VALUES(?,?,?,1)').run(f.networkId, 'process-now-preview', JSON.stringify({ preview, fingerprint: 'a'.repeat(64) }))
  store.db.prepare('INSERT INTO network_trace_events(network_id,kind,body,created_at) VALUES(?,?,?,1)').run(f.networkId, 'network-activated', JSON.stringify({ sources: [{ podId: f.pod.id, nextAt: 100 }] }))
  store = reopen(store)
  expect(store.db.prepare('SELECT state,consumed_at FROM network_process_previews').get()).toEqual({ state: 'stopped', consumed_at: 0 })
  expect(store.db.prepare('SELECT * FROM network_source_clocks').all()).toEqual([])
  expect(store.db.prepare('SELECT count(*) AS count FROM network_trace_events').get()?.count).toBe(2)
})
