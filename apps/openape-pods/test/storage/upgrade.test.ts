// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { createBackup, restoreBackup } from '../../src/worker/data/backup'
import { digest, PodDatabase, schemaVersion } from '../../src/worker/storage/database'

const roots: string[] = []; const stores: PodDatabase[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const schema45 = readFileSync(join(import.meta.dirname, 'fixtures/schema-45.sql'), 'utf8')
function directory(): string {
  const root = mkdtempSync(join(tmpdir(), 'pods-upgrade-')); roots.push(root); return root
}
function open(root: string): PodDatabase {
  const store = new PodDatabase(root); stores.push(store); return store
}
function objects(path: string): unknown[] {
  const database = new DatabaseSync(path, { readOnly: true })
  try { return database.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all() }
  finally { database.close() }
}

/** A schema-45 profile as the October 2026 releases wrote it, with one network member and history that schema 46 drops. */
function profile45(root: string, change = '') {
  const ids = { pod: randomUUID(), group: randomUUID(), definition: randomUUID(), network: randomUUID(), resource: randomUUID(), grant: randomUUID() }
  const owner = { issuer: 'https://identity.example.invalid', subject: 'synthetic-owner' }
  const database = new DatabaseSync(join(root, 'control.sqlite'))
  database.exec(schema45)
  const run = (sql: string, ...values: (string | number | null)[]) => database.prepare(sql).run(...values)
  database.exec('BEGIN')
  run('INSERT INTO pods VALUES(?,?,\'\',1,\'active\',NULL,3)', ids.pod, 'Synthetic member')
  run('INSERT INTO checkpoints VALUES(?,0,\'{}\')', ids.pod)
  run('INSERT INTO pod_groups VALUES(?,\'Company\',0)', ids.group)
  run('INSERT INTO pod_memberships VALUES(?,?)', ids.pod, ids.group)
  run('INSERT INTO network_owners VALUES(?,?)', owner.issuer, owner.subject)
  run('INSERT INTO pod_definitions VALUES(?,?,?,\'Definition\',1)', ids.definition, owner.issuer, owner.subject)
  run('INSERT INTO pod_definition_versions VALUES(?,1,?,?,\'{}\',1)', ids.definition, digest('script'), digest('lock'))
  run('INSERT INTO instance_definition_bindings VALUES(?,?,1,2)', ids.pod, ids.definition)
  run('INSERT INTO networks(id,owner_issuer,owner_subject,group_id,name,revision,restore_nonce,ancestor_workflow_id,created_at) VALUES(?,?,?,?,\'Network\',1,\'nonce\',\'workflow\',1)', ids.network, owner.issuer, owner.subject, ids.group)
  run('INSERT INTO network_revisions VALUES(?,1,\'{}\',?,1)', ids.network, digest('{}'))
  run('INSERT INTO network_members VALUES(?,?,2,?,1,NULL)', ids.network, ids.pod, ids.definition)
  run('INSERT INTO pod_grants VALUES(?,?,?,?,\'gh\',\'{}\',\'gh pr list\',\'always\',\'approved\',?,1,0,1,1)', ids.grant, ids.pod, owner.issuer, owner.subject, ids.network)
  run('INSERT INTO resources VALUES(?,?,1,\'credential\',\'ready\',\'Token\',\'{"alias":"token"}\')', ids.resource, ids.pod)
  run('INSERT INTO schedules VALUES(?,1,\'{"every":60}\',1,NULL,NULL)', ids.pod)
  run('INSERT INTO master_messages(rowid,id,role,body,state,created_at) VALUES(7,\'message\',\'user\',\'Original request\',\'sent\',1)')
  run('INSERT INTO collection_descriptions VALUES(?,\'What the network does\',1,1)', ids.network)
  run('INSERT INTO workflows(id,revision,name,nodes,archived) VALUES(\'workflow\',1,\'Retired workflow\',\'[]\',1)')
  run('INSERT INTO network_trace_events(id,network_id,kind,body,created_at) VALUES(41,?,\'pruned\',\'{}\',1)', ids.network)
  run('DELETE FROM network_trace_events')
  run('INSERT INTO network_trace_events(id,network_id,kind,body,created_at) VALUES(7,?,\'retained\',\'{}\',1)', ids.network)
  database.exec(`${change}COMMIT; PRAGMA user_version=45;`)
  database.close()
  return ids
}

it('creates a fresh profile whose schema equals an upgraded schema-45 profile', () => {
  const fresh = directory(); open(fresh).close(); stores.pop()
  const upgraded = directory(); profile45(upgraded); open(upgraded).close(); stores.pop()
  expect(objects(join(upgraded, 'control.sqlite'))).toEqual(objects(join(fresh, 'control.sqlite')))
})

it('upgrades schema 45 keeping every retained row, rowid and sequence and only the binding as member authority', () => {
  const root = directory(); const ids = profile45(root)
  const store = open(root)
  expect(store.db.prepare('PRAGMA user_version').get()!.user_version).toBe(schemaVersion)
  expect(readdirSync(root).filter(file => file.startsWith('before-v45-'))).toHaveLength(1)
  expect(store.getPod(ids.pod)).toMatchObject({ name: 'Synthetic member', lifecycle: 'active', revision: 3 })
  expect(store.db.prepare('SELECT * FROM network_members').all()).toEqual([{ network_id: ids.network, pod_id: ids.pod, source_binding_id: null }])
  expect(store.db.prepare('SELECT definition_id,binding_revision FROM instance_definition_bindings').get()).toEqual({ definition_id: ids.definition, binding_revision: 2 })
  expect(store.db.prepare('SELECT id,state,network_id FROM pod_grants').get()).toEqual({ id: ids.grant, state: 'approved', network_id: ids.network })
  expect(store.db.prepare('SELECT kind,configuration FROM resources').get()).toEqual({ kind: 'credential', configuration: '{"alias":"token"}' })
  expect(store.db.prepare('SELECT enabled FROM schedules').get()).toEqual({ enabled: 1 })
  expect(store.db.prepare('SELECT rowid AS sequence,body FROM master_messages').get()).toEqual({ sequence: 7, body: 'Original request' })
  expect(store.db.prepare('SELECT body FROM automation_descriptions').get()).toEqual({ body: 'What the network does' })
  expect(store.db.prepare('SELECT * FROM networks').get()).not.toHaveProperty('ancestor_workflow_id')
  expect(store.db.prepare('SELECT 1 FROM sqlite_schema WHERE name IN (\'workflows\',\'collection_descriptions\',\'master_session\',\'instance_config\')').all()).toEqual([])
  store.db.prepare('INSERT INTO network_trace_events(network_id,kind,body,created_at) VALUES(?,\'next\',\'{}\',2)').run(ids.network)
  expect(store.db.prepare('SELECT id FROM network_trace_events ORDER BY id').all()).toEqual([{ id: 7 }, { id: 42 }])
})

it('refuses an upgrade whose two member binding copies disagree and leaves schema 45 untouched', () => {
  const root = directory(); profile45(root, 'UPDATE network_members SET binding_revision=3;')
  expect(() => open(root)).toThrow('binding that differs')
  const database = new DatabaseSync(join(root, 'control.sqlite'), { readOnly: true })
  try { expect(database.prepare('SELECT user_version, (SELECT count(*) FROM workflows) AS workflows FROM pragma_user_version').get()).toEqual({ user_version: 45, workflows: 1 }) }
  finally { database.close() }
})

it('refuses a schema-45 database with any foreign object before executing a statement', () => {
  for (const crafted of ['CREATE TABLE "x""; DROP TABLE pods; --"(a);', 'CREATE TRIGGER t AFTER INSERT ON runs BEGIN DELETE FROM pods; END;', 'CREATE VIEW v AS SELECT 1;']) {
    const root = directory(); profile45(root, crafted)
    expect(() => open(root)).toThrow('does not have the schema 45 it declares')
    const database = new DatabaseSync(join(root, 'control.sqlite'), { readOnly: true })
    try { expect(database.prepare('SELECT user_version, (SELECT count(*) FROM pods) AS pods, (SELECT count(*) FROM workflows) AS workflows FROM pragma_user_version').get()).toEqual({ user_version: 45, pods: 1, workflows: 1 }) }
    finally { database.close() }
  }
})

it('refuses a profile older than schema 45 without changing its bytes', () => {
  const root = directory(); const database = new DatabaseSync(join(root, 'control.sqlite'))
  database.exec('CREATE TABLE pods(id TEXT PRIMARY KEY); PRAGMA user_version=44;'); database.close()
  const before = readFileSync(join(root, 'control.sqlite'))
  expect(() => open(root)).toThrow('created by an older OpenApe Pods version')
  expect(readFileSync(join(root, 'control.sqlite'))).toEqual(before)
  expect(readdirSync(root)).toEqual(['control.sqlite'])
})

it('restores a schema-45 backup as schema 46 and refuses an older one', async () => {
  const exports = directory(); const source = directory()
  const backup = await createBackup(open(source), exports)
  const legacy = directory(); const ids = profile45(legacy)
  const bytes = readFileSync(join(legacy, 'control.sqlite'))
  writeFileSync(join(backup, 'control.sqlite'), bytes)
  mkdirSync(join(backup, 'blobs')); writeFileSync(join(backup, 'blobs', digest('script')), 'script')
  const manifest = JSON.parse(readFileSync(join(backup, 'backup.json'), 'utf8'))
  manifest.schema = 45
  manifest.files = [...manifest.files.map((file: { path: string }) => file.path === 'control.sqlite' ? { path: file.path, size: bytes.length, hash: digest(bytes) } : file), { path: `blobs/${digest('script')}`, size: 6, hash: digest('script') }]
  writeFileSync(join(backup, 'backup.json'), JSON.stringify(manifest))
  const restored = open(await restoreBackup(backup, exports, schemaVersion))
  expect(restored.db.prepare('PRAGMA user_version').get()!.user_version).toBe(schemaVersion)
  expect(restored.db.prepare('SELECT state,baseline_state FROM networks WHERE id=?').get(ids.network)).toEqual({ state: 'paused', baseline_state: 'review_required' })
  expect(restored.getPod(ids.pod).lifecycle).toBe('paused')
  writeFileSync(join(backup, 'backup.json'), JSON.stringify({ ...manifest, schema: 44 }))
  await expect(restoreBackup(backup, exports, schemaVersion)).rejects.toThrow('created by an older OpenApe Pods version')
})
