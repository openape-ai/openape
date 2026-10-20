import { upgradeToCurrent } from '../../src/worker/storage/upgrade'
// @vitest-environment node
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it, vi } from 'vitest'
import { PodDatabase, digest, schemaVersion } from '../../src/worker/storage/database'
import { schema53Shared } from '../../src/worker/storage/schema53-shared'
import { sharedTables } from '../../src/worker/storage/retire-shared'
import { createBackup, restoreBackup } from '../../src/worker/data/backup'
import { assertCurrentScript } from '../../src/contracts/retired-storage'

const roots: string[] = []
const stores: PodDatabase[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function directory() { const root = mkdtempSync(join(tmpdir(), 'pods-retire-')); roots.push(root); return root }
function open(root: string) { const store = new PodDatabase(root); stores.push(store); return store }
function previous(retain = false) {
  const root = directory(); const store = new PodDatabase(root)
  const pod = store.createPod({ name: 'Independent Pod' })
  store.db.prepare('UPDATE checkpoints SET body=? WHERE pod_id=?').run('{"private":true}', pod.id)
  store.db.exec(schema53Shared)
  store.db.exec('INSERT INTO data_sequence VALUES(1,1); INSERT INTO data_namespaces VALUES(\'old/records\',\'owner\',\'records\',NULL,1,1,1,1)')
  store.db.prepare('INSERT INTO data_readers VALUES(?,?)').run('old/records', pod.id)
  store.db.prepare('INSERT INTO data_entries VALUES(?,?,1,1,?,0,?,?,NULL,1,NULL,1)').run('old/records', 'one', '{"old":true}', 'a'.repeat(64), 'owner')
  store.db.prepare('INSERT INTO action_approvals(id,pod_id,action,object,payload,payload_hash,title,authority,state,created_at,updated_at) VALUES(\'history\',?,\'mail.archive\',\'mail\',\'{}\',?,\'Historical approval\',\'{}\',\'collecting\',1,1)').run(pod.id, 'b'.repeat(64))
  store.db.prepare('INSERT INTO data_entry_revisions VALUES(?,?,1,?,0,?,?,NULL,NULL,1)').run('old/records', 'one', '{"old":true}', 'a'.repeat(64), 'owner')
  store.db.exec("INSERT INTO work_operations VALUES('old/classify','old/records','old/records','[]','{}',1,0,0,1)")
  store.db.prepare("INSERT INTO work_items(key,operation,object,input_revision,fingerprint,rule_version,generation,state,ready_at,created_at,updated_at) VALUES(?,'old/classify','one',1,?,1,0,'waiting',1,1,1)").run('c'.repeat(64), 'd'.repeat(64))
  store.db.prepare("INSERT INTO owner_questions VALUES('old-question',?,'old/records','one','fingerprint','Old question','','[]','{}','withdrawn',NULL,NULL,1)").run(pod.id)
  store.db.exec('PRAGMA user_version=53')
  if (retain) stores.push(store)
  else store.close()
  return { root, pod, store }
}
function snapshot(database: DatabaseSync) {
  return Object.fromEntries(database.prepare('SELECT name FROM sqlite_schema WHERE type=\'table\' AND name NOT LIKE \'sqlite_%\' ORDER BY name').all().filter(row => !sharedTables.includes(row.name as typeof sharedTables[number]) && row.name !== 'storage_receipts').map(row => [row.name, database.prepare(`SELECT * FROM "${String(row.name)}" ORDER BY rowid`).all()]))
}
it('purges shared tables, preserves every unrelated row and creates one verified private backup; reopening is unchanged', () => {
  const { root } = previous(); const before = new DatabaseSync(join(root, 'control.sqlite')); const kept = snapshot(before); before.close()
  const store = open(root)
  expect(snapshot(store.db)).toEqual(kept)
  expect(store.db.prepare('PRAGMA user_version').get()!.user_version).toBe(schemaVersion)
  for (const table of sharedTables) expect(store.db.prepare('SELECT name FROM sqlite_schema WHERE name=?').get(table)).toBeUndefined()
  const receipt = JSON.parse(String(store.db.prepare('SELECT body FROM storage_receipts WHERE json_extract(body,\'$.retired\')=\'shared-storage\'').get()!.body))
  expect(receipt.removed).toMatchObject({ data_namespaces: 1, data_readers: 1, data_entries: 1, data_entry_revisions: 1, work_operations: 1, work_items: 1, owner_questions: 1 })
  const backup = readdirSync(root).find(name => name.startsWith('before-v53-'))!
  const saved = new DatabaseSync(join(root, backup), { readOnly: true })
  expect(saved.prepare('SELECT count(*) AS n FROM data_entries').get()!.n).toBe(1); saved.close()
  store.close(); stores.pop()
  const repeat = open(root)
  expect(snapshot(repeat.db)).toEqual(kept)
  expect(repeat.db.prepare('SELECT count(*) AS n FROM storage_receipts').get()!.n).toBe(1)
  expect(readdirSync(root).filter(name => name.startsWith('before-v53-'))).toEqual([backup])
})
it('rolls back all drops and the schema version when the transaction cannot record its receipt', () => {
  const { root } = previous(); const db = new DatabaseSync(join(root, 'control.sqlite'))
  const before = snapshot(db)
  const prepare = db.prepare.bind(db)
  const fault = vi.spyOn(db, 'prepare').mockImplementation((sql) => {
    if (sql.includes('INSERT INTO storage_receipts')) throw new Error('Simulated interruption before commit')
    return prepare(sql)
  })
  db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE')
  try { expect(() => upgradeToCurrent(db, 53)).toThrow('Simulated interruption') }
  finally { db.exec('ROLLBACK'); fault.mockRestore() }
  expect(db.prepare('PRAGMA user_version').get()!.user_version).toBe(53)
  expect(db.prepare('SELECT count(*) AS n FROM data_entries').get()!.n).toBe(1)
  expect(snapshot(db)).toEqual(before); db.close()
  expect(open(root).db.prepare('PRAGMA user_version').get()!.user_version).toBe(schemaVersion)
})
it.each(['context.data.get("old/one")', 'ctx.work.find({})', 'context["decisions"].ask({})', 'export const work = []', 'export const polls = true'])('rejects retired script access before import or activation: %s', (source) => {
  expect(() => assertCurrentScript(source.startsWith('export') ? source : `export async function run(${source.startsWith('ctx') ? 'ctx' : 'context'}) { await ${source} }`)).toThrow('retired')
})
it('fresh profiles and their restored backups contain no shared tables and preserve private checkpoints', async () => {
  const store = open(directory()); const pod = store.createPod({ name: 'Private state' })
  store.db.prepare('UPDATE checkpoints SET body=? WHERE pod_id=?').run('{"cursor":42}', pod.id)
  const destination = directory(); const backup = await createBackup(store, destination)
  const restored = open(await restoreBackup(backup, destination, schemaVersion))
  expect(restored.checkpoint(pod.id).body).toEqual({ cursor: 42 })
  for (const table of sharedTables) expect(restored.db.prepare('SELECT name FROM sqlite_schema WHERE name=?').get(table)).toBeUndefined()
})

it('follows renamed context parameters and aliases, while allowing comments and string examples', () => {
  expect(() => assertCurrentScript('export async function run(input) { const alias = input; await alias.data.get("old/one") }')).toThrow('retired')
  expect(() => assertCurrentScript('export async function run({ work }) { await work.find({}) }')).toThrow('retired')
  expect(() => assertCurrentScript('export async function run(context) { /* context.data.get() */ return "context.work is retired" }')).not.toThrow()
})

it('refuses a nonarchived legacy script without changing the profile, then permits inert archived history', () => {
  const { root, pod } = previous()
  const db = new DatabaseSync(join(root, 'control.sqlite'))
  const code = 'export async function run(input) { await input.data.get("old/records/one") }'
  const hash = digest(code)
  mkdirSync(join(root, 'blobs'), { recursive: true })
  writeFileSync(join(root, 'blobs', hash), code)
  const manifest = { schemaVersion: 1, contentHash: hash, entrypoint: 'run.mjs', dependencyLockHash: 'a'.repeat(64), runtimeVersion: 'fixture', capabilities: [], triggers: ['manual'], inputSchemaHash: 'a'.repeat(64), outputSchemaHash: 'a'.repeat(64), checkpointSchemaVersion: 1, assignmentRevision: 1, effects: 'readOnly' }
  db.prepare('INSERT INTO scripts VALUES(?,?,?)').run(pod.id, hash, JSON.stringify(manifest))
  db.prepare('UPDATE pods SET active_script=?,lifecycle=\'active\' WHERE id=?').run(hash, pod.id)
  expect(() => new PodDatabase(root)).toThrow('prevents shared storage retirement')
  expect(db.prepare('PRAGMA user_version').get()!.user_version).toBe(53)
  expect(db.prepare('SELECT count(*) AS n FROM data_entries').get()!.n).toBe(1)
  expect(readdirSync(root).filter(name => name.startsWith('before-'))).toEqual([])
  db.prepare('UPDATE pods SET lifecycle=\'archived\' WHERE id=?').run(pod.id); db.close()
  const migrated = open(root)
  expect(migrated.getPod(pod.id).activeScript).toBe(hash)
  expect(migrated.readBlob(hash).toString()).toBe(code)
  expect(() => migrated.updatePod(pod.id, 1, { name: pod.name, lifecycle: 'active' })).toThrow('retired')
  expect(() => migrated.storeScript(pod.id, manifest, code)).toThrow('retired')
})

it('restores a populated old backup through retirement, preserving history without recreating shared storage', async () => {
  const { store, pod } = previous(true)
  const destination = directory()
  const backup = await createBackup(store, destination)
  const restored = open(await restoreBackup(backup, destination, schemaVersion))
  expect(restored.checkpoint(pod.id).body).toEqual({ private: true })
  expect(restored.db.prepare("SELECT title FROM action_approvals WHERE id='history'").get()!.title).toBe('Historical approval')
  for (const table of sharedTables) expect(restored.db.prepare('SELECT name FROM sqlite_schema WHERE name=?').get(table)).toBeUndefined()
  const original = new DatabaseSync(join(backup, 'control.sqlite'), { readOnly: true })
  expect(original.prepare('PRAGMA user_version').get()!.user_version).toBe(53)
  expect(original.prepare('SELECT count(*) AS n FROM data_entries').get()!.n).toBe(1)
  original.close()
})
