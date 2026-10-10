import { ResourceRegistry } from '../../src/worker/resources/registry'
import { RunDispatcher } from '../../src/worker/runs/dispatcher'
import type { AgentRuntime } from '../../src/worker/agent/executor'
import { Scheduler } from '../../src/worker/scheduling/scheduler'
import { PodGroups } from '../../src/worker/workspace/groups'
// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { PodDatabase } from '../../src/worker/storage/database'
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

it('persists separate bindings and durable receipts with restrictive ownership and version constraints', () => {
  let store = fixture(); const f = seedNetwork(store)
  expect(() => store.db.prepare('INSERT INTO network_members VALUES(?,?,NULL)').run(f.networkId, f.pod.id)).toThrow('UNIQUE')
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
  expect(() => new PodDatabase(store.root)).toThrow('Incomplete or altered storage')
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

it('rejects effect authority crossing a network even when both networks exist', () => {
  const store = fixture(); const f = seedNetwork(store); const other = randomUUID()
  store.transaction(() => {
    store.db.prepare('INSERT INTO networks(id,owner_issuer,owner_subject,group_id,name,revision,restore_nonce,created_at) VALUES(?,?,?,?,?,1,?,1)').run(other, f.owner.issuer, f.owner.subject, f.groupId, 'Another network', randomUUID())
    store.db.prepare('INSERT INTO network_revisions VALUES(?,1,?,?,1)').run(other, '{}', '0'.repeat(64))
  })
  expect(() => store.db.prepare('UPDATE network_effect_attempts SET network_id=?').run(other)).toThrow('FOREIGN KEY')
  expect(store.db.prepare('SELECT network_id FROM network_effect_attempts').get()?.network_id).toBe(f.networkId)
})

it('refuses direct legacy dispatch and intake without reserving a network instance', () => {
  const store = fixture(); const resources = new ResourceRegistry(store, () => {})
  const dispatcher = new RunDispatcher(store, resources, {} as AgentRuntime)
  const f = seedNetwork(store); const beforeRuns = store.db.prepare('SELECT * FROM runs').all()
  const scheduler = new Scheduler(store, dispatcher)
  expect(() => dispatcher.start(f.pod.id)).toThrow('Network instances require')
  expect(() => scheduler.requestManual(f.pod.id)).toThrow('Network instances require')
  expect(() => scheduler.acceptEvent(f.pod.id, 'manual', 'source', {})).toThrow('Network instances require')
  expect(store.db.prepare('SELECT * FROM runs').all()).toEqual(beforeRuns)
  expect(store.db.prepare('SELECT * FROM run_leases').all()).toEqual([])
  expect(store.db.prepare('SELECT * FROM accepted_events').all()).toEqual([])
})
