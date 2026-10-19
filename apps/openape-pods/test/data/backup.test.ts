// @vitest-environment node
import { appendFile, chmod, mkdtemp, mkdir, lstat, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { PodDatabase, digest, schemaVersion } from '../../src/worker/storage/database'
import { createBackup, restoreBackup } from '../../src/worker/data/backup'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { ItemTagStore } from '../../src/worker/workspace/item-tags'
import { storageBytes } from '../../src/worker/data/files'
import { ChatRegistry } from '../../src/worker/master/chat-registry'
import { MasterConversations } from '../../src/worker/master/conversations'
import { Scheduler } from '../../src/worker/scheduling/scheduler'
import { DatabaseSync } from 'node:sqlite'
import { cleanupEncryptedBackupStaging, encryptedBackupStaging } from '../../src/worker/data/encrypted-backup'
import { DomainData } from '../../src/worker/data/domain'
import { DataRetention } from '../../src/worker/data/retention'
import { DataControl } from '../../src/worker/data/control'

vi.mock('node:fs/promises', async (importOriginal) => {
  const files = await importOriginal<typeof import('node:fs/promises')>()
  return { ...files, rm: vi.fn(files.rm) }
})

const stores: PodDatabase[] = []; const roots: string[] = []
afterEach(async () => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'Pods Müller backup '))); roots.push(base)
  const root = join(base, 'profile'); const exports = join(base, 'exports'); await mkdir(exports)
  const store = new PodDatabase(root); stores.push(store)
  const pod = store.createPod({ name: 'Orders' })
  store.commitProgress({ podId: pod.id, expectedRevision: 0, checkpoint: { cursor: 'committed' }, sources: [{ id: 'source', version: 'v1', locator: 'fixture:source', content: 'Delivery Friday' }], claims: [{ id: 'claim', matter: 'order', kind: 'finding', text: 'Delivery Friday', sourceIds: ['source'] }] })
  const code = 'export async function run() {}'
  store.storeScript(pod.id, { schemaVersion: 1, contentHash: digest(code), entrypoint: 'run.mjs', dependencyLockHash: digest('lock'), runtimeVersion: 'node24', capabilities: [], triggers: ['manual'], inputSchemaHash: digest('input'), outputSchemaHash: digest('output'), checkpointSchemaVersion: 1, assignmentRevision: 1, effects: 'readOnly' }, code)
  store.db.prepare('UPDATE pods SET active_script=?,lifecycle=\'active\' WHERE id=?').run(digest(code), pod.id)
  store.db.prepare('INSERT INTO schedules VALUES(?,1,?,1,?,NULL)').run(pod.id, JSON.stringify({ kind: 'interval', seconds: 60 }), Date.now() + 60000)
  store.db.prepare('INSERT INTO connections VALUES(?,?,?,?,?,?)').run(randomUUID(), 'microsoft', 'synthetic@example.invalid', 'ready', null, JSON.stringify({ binding: 'metadata only' }))
  const workspace = join(root, 'pods', pod.id, 'workspace'); await mkdir(workspace, { recursive: true }); await writeFile(join(workspace, 'notes.txt'), 'Durable workspace')
  await mkdir(join(root, 'credentials')); await writeFile(join(root, 'credentials', 'synthetic.encrypted'), 'MUST_NOT_EXPORT')
  const runId = randomUUID(); store.db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?)').run(runId, pod.id, digest(code), 'completed', Date.now(), Date.now(), 'Completed', null, 1, 1)
  return { base, root, exports, store, pod, runId, workspace }
}
it('restores settings, checkpoint, knowledge, citations, script, workspace and run history into a fresh paused profile', async () => {
  const { store, exports, pod, runId } = await fixture()
  new ItemTagStore(store).execute({ type: 'tag', id: pod.id, revision: 0, tags: ['clients'] })
  new ResourceRegistry(store, () => {}).assignCredential(pod.id, 'crm', randomUUID(), 0)
  store.db.prepare('INSERT INTO script_credential_approvals VALUES(?,?,?,?)').run(pod.id, store.getPod(pod.id).activeScript!, 1, 1)
  store.db.prepare('INSERT INTO pod_variables VALUES(?,?,?,?)').run(pod.id, 'topic', 'Orders', 1)
  store.db.prepare('INSERT INTO master_contexts VALUES(?,?,?,?)').run(pod.id, 'old-thread', 'idle', null)
  const backup = await createBackup(store, exports); const target = await restoreBackup(backup, exports, schemaVersion)
  const restored = new PodDatabase(target); stores.push(restored)
  expect(restored.db.prepare('SELECT value FROM pod_variables WHERE pod_id=?').get(pod.id)?.value).toBe('Orders')
  expect(restored.db.prepare('SELECT thread_id,state FROM master_contexts WHERE scope=?').get(pod.id)).toMatchObject({ thread_id: null, state: 'interrupted' })
  expect(new ItemTagStore(restored).view()).toEqual(new ItemTagStore(store).view())
  expect(restored.db.prepare('SELECT * FROM script_credential_approvals').all()).toEqual([])
  expect(new ResourceRegistry(restored, () => {}).list(pod.id)[0]?.state).toBe('refreshRequired')
  expect(restored.getPod(pod.id)).toMatchObject({ name: 'Orders', lifecycle: 'paused', activeScript: store.getPod(pod.id).activeScript })
  expect(restored.checkpoint(pod.id)).toEqual(store.checkpoint(pod.id)); expect(restored.knowledge(pod.id)).toEqual(store.knowledge(pod.id))
  const source = restored.db.prepare('SELECT hash FROM sources').get()!.hash as string; expect(restored.readBlob(source).toString()).toBe('Delivery Friday')
  expect(restored.db.prepare('SELECT state FROM runs WHERE id=?').get(runId)?.state).toBe('completed')
  expect(restored.db.prepare('SELECT enabled FROM schedules').get()?.enabled).toBe(0)
  expect(restored.db.prepare('SELECT state,metadata FROM connections').get()).toMatchObject({ state: 'revoked', metadata: '{}' })
  expect(await readFile(join(target, 'pods', pod.id, 'workspace/notes.txt'), 'utf8')).toBe('Durable workspace')
  expect(await readdir(backup)).not.toContain('credentials'); await expect(readFile(join(target, 'credentials/synthetic.encrypted'))).rejects.toMatchObject({ code: 'ENOENT' })
})
it('leaves the last good backup and checkpoint intact after a simulated disk-full write', async () => {
  const { store, exports, pod } = await fixture(); const good = await createBackup(store, exports); const before = store.checkpoint(pod.id)
  await expect(createBackup(store, exports, () => { throw Object.assign(new Error('Disk full'), { code: 'ENOSPC' }) })).rejects.toThrow('Disk full')
  expect(store.checkpoint(pod.id)).toEqual(before); expect(await readdir(exports)).toEqual([good.split('/').at(-1)])
})
it('preserves remote ownership but drops the desktop registration after restoring without credentials', async () => {
  const { store, exports, pod } = await fixture()
  const owner = JSON.stringify({ issuer: 'https://id.example', subject: 'owner@example.test' })
  const identity = JSON.stringify({ subject: 'existing-agent@example.test', keyId: 'original-key' })
  store.db.prepare('INSERT INTO remote_pods VALUES(?,?,?,?,?,?,NULL)').run(pod.id, owner, randomUUID(), randomUUID(), 'ready', identity)
  store.db.prepare('INSERT INTO remote_registration VALUES(1,?,1)').run('{}')
  const backup = await createBackup(store, exports)
  const restored = new PodDatabase(await restoreBackup(backup, exports, schemaVersion)); stores.push(restored)
  expect(restored.db.prepare('SELECT owner,identity,phase FROM remote_pods').get()).toMatchObject({ owner, identity, phase: 'needs_desktop_action' })
  expect(restored.db.prepare('SELECT * FROM remote_registration').all()).toEqual([])
})
it('rejects corrupted evidence and traversal without publishing a partial restored profile', async () => {
  const { store, exports } = await fixture(); const backup = await createBackup(store, exports)
  const manifest = JSON.parse(await readFile(join(backup, 'backup.json'), 'utf8'))
  const blob = manifest.files.find((item: { path: string }) => item.path.startsWith('blobs/'))
  await writeFile(join(backup, blob.path), 'CORRUPT')
  await expect(restoreBackup(backup, exports, schemaVersion)).rejects.toThrow('checksum')
  manifest.files[0].path = '../outside'; await writeFile(join(backup, 'backup.json'), JSON.stringify(manifest))
  await expect(restoreBackup(backup, exports, schemaVersion)).rejects.toThrow('path')
  expect((await readdir(exports)).filter(name => name.startsWith('.restore'))).toHaveLength(0)
})
it('rejects workspace links, newer schemas and backups while work is active', async () => {
  const { store, exports, workspace, runId, pod } = await fixture()
  await symlink('/unassigned', join(workspace, 'link'))
  await expect(createBackup(store, exports)).rejects.toThrow('link')
  await rm(join(workspace, 'link')); const backup = await createBackup(store, exports)
  await expect(restoreBackup(backup, exports, schemaVersion - 1)).rejects.toThrow('newer')
  store.db.prepare('INSERT INTO run_leases VALUES(?,?,?,?,NULL)').run(pod.id, runId, 'synthetic-boot', Date.now())
  await expect(createBackup(store, exports)).rejects.toThrow('active work')
})
it('blocks cleanup and restore during a running script validation but not for running MCP journal entries', async () => {
  const { store, exports } = await fixture()
  const backup = await createBackup(store, exports)
  const data = new DataControl(store, 'unused-helper')
  const journal = (id: string, action: string) => store.db.prepare('INSERT INTO master_actions VALUES(?,?,?,\'running\',NULL,NULL)').run(id, 'hash', JSON.stringify({ action }))
  journal(`codex-admin:${randomUUID()}`, 'desktop')
  expect(await data.execute({ type: 'status' })).toMatchObject({ busy: false })
  await data.execute({ type: 'cleanup' })
  journal(`owner-script:${randomUUID()}`, 'validate')
  expect(await data.execute({ type: 'status' })).toMatchObject({ busy: true })
  await expect(data.execute({ type: 'cleanup' })).rejects.toThrow('active work')
  await expect(data.execute({ type: 'restore', source: backup, parent: exports })).rejects.toThrow('active work')
})
it('retains referenced evidence and pending events while deleting only orphan blobs', async () => {
  const { store, pod } = await fixture(); const orphan = store.putBlob('uncommitted orphan')
  store.db.prepare('INSERT INTO accepted_events(id,pod_id,source,dedupe_key,payload,accepted_at) VALUES(?,?,\'manual\',\'pending\',\'{}\',?)').run(randomUUID(), pod.id, Date.now())
  const retention = new DataRetention(store, 'unused-helper'); await retention.cleanup()
  await expect(readFile(join(store.blobs, orphan))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(store.knowledge(pod.id)).toHaveLength(1); expect(store.db.prepare('SELECT state FROM accepted_events').get()?.state).toBe('pending')
  expect((await retention.view()).usedBytes).toBeGreaterThan(0)
})
it('deletes an archived pod locally without deleting shared connections or original files', async () => {
  const { store, pod, root, exports, base } = await fixture(); const original = join(base, 'original.txt'); await writeFile(original, 'OWNER_FILE')
  const credentialId = randomUUID(); new ResourceRegistry(store, () => {}).assignCredential(pod.id, 'crm', credentialId, 0)
  const retention = new DataRetention(store, 'unused-helper')
  await expect(retention.deletePod(pod.id, pod.revision, pod.name)).rejects.toThrow('Archive')
  store.updatePod(pod.id, 1, { name: pod.name, lifecycle: 'archived' })
  await expect(retention.deletePod(pod.id, 1, pod.name)).rejects.toThrow('Archive and review')
  await expect(retention.deletePod(pod.id, 2, 'Unreviewed name')).rejects.toThrow('Archive and review')
  await retention.deletePod(pod.id, 2, pod.name)
  expect(store.listPods()).toEqual([]); expect(store.db.prepare('SELECT * FROM connections').all()).toHaveLength(1)
  expect(await readFile(original, 'utf8')).toBe('OWNER_FILE'); expect(await readdir(exports)).toEqual([])
  await expect(readFile(join(root, 'pods', pod.id, 'workspace/notes.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(JSON.stringify(retention.jobs())).toContain(credentialId)
  expect(retention.jobs()).toHaveLength(1); retention.finishDeletion(pod.id); expect(retention.jobs()).toHaveLength(0)
})
it('blocks new storage at the sampled limit and clears the block after space is available', async () => {
  const { store } = await fixture(); const retention = new DataRetention(store, 'unused-helper')
  retention.limit(1); expect((await retention.view()).error).toContain('limit reached')
  expect(() => store.putBlob('new content')).toThrow('Storage')
  retention.limit(1024 ** 3); expect((await retention.view()).error).toBeNull(); expect(() => store.putBlob('new content')).not.toThrow()
})

it('requests an early full inventory only when tracked usage reaches the limit or a storage error is set', async () => {
  const { store } = await fixture(); const retention = new DataRetention(store, 'unused-helper')
  await retention.view(); expect(await retention.inspectionDue()).toBe(false)
  store.putBlob('tracked between inventories'); expect(await retention.inspectionDue()).toBe(false)
  retention.limit(1); expect(await retention.inspectionDue()).toBe(true)
  expect((await retention.view()).error).toContain('limit reached')
  retention.limit(1024 ** 3); expect(await retention.inspectionDue()).toBe(true)
  expect((await retention.view()).error).toBeNull(); expect(await retention.inspectionDue()).toBe(false)
})

it('re-measures active runs every time and a settled run only after its folder changes', async () => {
  const { store, root, runId } = await fixture(); const retention = new DataRetention(store, 'unused-helper')
  const mebibyte = Buffer.alloc(1024 * 1024, 1); const agent = join(root, 'runs', runId, 'agent'); await mkdir(agent, { recursive: true })
  const used = async () => (await retention.view()).usedBytes
  const grewBy = (after: number, before: number, bytes: number) => expect(Math.abs(after - before - bytes)).toBeLessThan(128 * 1024)
  await writeFile(join(agent, 'output.bin'), mebibyte); const first = await used()
  await appendFile(join(agent, 'output.bin'), mebibyte); const recent = await used()
  grewBy(recent, first, mebibyte.length)
  store.db.prepare('UPDATE runs SET finished_at=? WHERE id=?').run(Date.now() - 600000, runId); const settled = await used()
  await chmod(agent, 0o000)
  try { grewBy(await used(), settled, 0) }
  finally { await chmod(agent, 0o700) }
  await writeFile(join(root, 'runs', runId, 'late.bin'), mebibyte); const changed = await used()
  grewBy(changed, settled, mebibyte.length)
  await rm(join(root, 'runs', runId), { recursive: true }); grewBy(await used(), changed, -3 * mebibyte.length)
})

it('leaves an idle database unchanged although each measurement includes the growing WAL', async () => {
  const { store } = await fixture(); const retention = new DataRetention(store, 'unused-helper')
  await retention.view()
  const changes = () => Number(store.db.prepare('SELECT total_changes() AS changes').get()!.changes)
  const before = changes()
  for (let index = 0; index < 5; index++) await retention.view()
  expect(changes()).toBe(before)
})
it('restores immutable reference snapshots at their new path with read-only permissions', async () => {
  const { store, root, pod, exports } = await fixture(); const id = randomUUID(); const file = randomUUID()
  const directory = join(root, 'snapshots', pod.id, id); await mkdir(directory, { recursive: true })
  await writeFile(join(directory, file), 'REFERENCE_BYTES')
  store.db.prepare('INSERT INTO snapshot_sets VALUES(?,?,1,?)').run(id, pod.id, JSON.stringify({ id, files: [{ id: file, hash: digest('REFERENCE_BYTES'), content: join(directory, file) }] }))
  const backup = await createBackup(store, exports); const target = await restoreBackup(backup, exports, schemaVersion)
  const restored = new PodDatabase(target); stores.push(restored)
  const snapshot = JSON.parse(restored.db.prepare('SELECT manifest FROM snapshot_sets').get()!.manifest as string)
  expect(snapshot.files[0].content).toBe(join(target, 'snapshots', pod.id, id, file))
  expect(await readFile(snapshot.files[0].content, 'utf8')).toBe('REFERENCE_BYTES'); expect((await lstat(snapshot.files[0].content)).mode & 0o777).toBe(0o400)
})

it('counts runtime links without following them and clears the old inventory warning', async () => {
  const { store, root, base, runId, exports, workspace } = await fixture()
  const temporary = join(root, 'runs', runId, 'agent-fixture/confined/home/codex/tmp/arg0/fixture')
  await mkdir(temporary, { recursive: true })
  const outside = join(base, 'outside'); await mkdir(outside); await writeFile(join(outside, 'private'), 'x'.repeat(100000))
  await symlink(join(outside, 'private'), join(temporary, 'apply_patch'))
  await symlink(outside, join(temporary, 'directory'))
  await symlink('/missing-fixture-file', join(temporary, 'dangling'))
  const expected = (await Promise.all(['apply_patch', 'directory', 'dangling'].map(async name => (await lstat(join(temporary, name))).size))).reduce((sum, size) => sum + size, 0)
  expect(await storageBytes(join(root, 'runs'))).toBe(expected)
  store.db.prepare('UPDATE data_settings SET error=?').run('Data inventory contains a link or unsupported file: runs/fixture')
  expect((await new DataRetention(store, 'unused-helper').view()).error).toBeNull()
  expect(store.db.prepare('SELECT error FROM data_settings').get()?.error).toBeNull()
  await expect(createBackup(store, exports)).resolves.toBeTruthy()
  await symlink(outside, join(workspace, 'untrusted'))
  await expect(createBackup(store, exports)).rejects.toThrow('link or unsupported file')
})
it('retains original and shared conversations after Pod deletion with an unavailable target', async () => {
  const { store, pod } = await fixture(); const registry = new ChatRegistry(store); const conversations = new MasterConversations(store)
  const original = registry.ensure(pod.id); const id = randomUUID()
  registry.execute({ type: 'create', id, title: 'Shared work', podIds: [pod.id] })
  for (const chat of [original, registry.get(id)]) {
    const messageId = randomUUID()
    store.db.prepare('INSERT INTO master_messages VALUES(?,?,?,?,?)').run(messageId, 'user', 'Keep this history', 'sent', 1)
    conversations.assign(messageId, chat.scope)
  }
  store.updatePod(pod.id, 1, { name: pod.name, lifecycle: 'archived' })
  await new DataRetention(store, 'unused-helper').deletePod(pod.id, 2, pod.name)
  for (const chat of [original, registry.get(id)]) {
    expect(registry.get(chat.id).unavailablePodIds).toEqual([pod.id])
    expect(conversations.messages(chat.scope)[0]?.text).toBe('Keep this history')
  }
})

it('restores chat history while discarding every provider continuation', async () => {
  const { store, pod, exports } = await fixture(); const registry = new ChatRegistry(store); const chat = registry.ensure(pod.id)
  const messageId = randomUUID(); store.db.prepare('INSERT INTO master_messages VALUES(?,?,?,?,?)').run(messageId, 'user', 'Saved history', 'sent', 1)
  new MasterConversations(store).assign(messageId, chat.scope)
  store.db.prepare('INSERT OR REPLACE INTO master_contexts VALUES(?,?,?,?)').run(chat.scope, 'old-provider-thread', 'idle', null)
  const backup = await createBackup(store, exports); const target = await restoreBackup(backup, exports, schemaVersion)
  const restored = new PodDatabase(target); stores.push(restored)
  expect(new MasterConversations(restored).messages(chat.scope)[0]?.text).toBe('Saved history')
  expect(new MasterConversations(restored).session(chat.scope).threadId).toBeNull()
})

async function retentionFixture(count = 55) {
  const f = await fixture()
  f.store.db.prepare('UPDATE runs SET started_at=0,finished_at=1 WHERE id=?').run(f.runId)
  const ids = [f.runId]
  for (let index = 1; index < count; index++) {
    const id = randomUUID(); ids.push(id)
    f.store.db.prepare('INSERT INTO runs VALUES(?,?,?,\'completed\',?,?,?,NULL,1,1)').run(id, f.pod.id, f.store.getPod(f.pod.id).activeScript!, index, index + 1, 'Finished')
  }
  for (const id of ids) {
    await mkdir(join(f.root, 'runs', id), { recursive: true })
    await writeFile(join(f.root, 'runs', id, 'output.txt'), 'Execution output')
  }
  return { ...f, ids, retention: new DataRetention(f.store, 'unused-helper') }
}

it('keeps the newest 50 rows and folders while preserving Pod data and processed input deduplication', async () => {
  const f = await retentionFixture()
  const before = { pods: f.store.listPods(), checkpoint: f.store.checkpoint(f.pod.id), knowledge: f.store.knowledge(f.pod.id), schedules: f.store.db.prepare('SELECT * FROM schedules').all() }
  const event = randomUUID()
  f.store.db.prepare('INSERT INTO accepted_events(id,pod_id,source,dedupe_key,payload,accepted_at,state,run_id) VALUES(?,?,\'manual\',\'original\',\'{"body":"old input"}\',1,\'processed\',?)').run(event, f.pod.id, f.runId)
  f.store.db.prepare('INSERT INTO run_inputs(run_id,reason,event_ids) VALUES(?,\'manual\',?)').run(f.runId, JSON.stringify([event]))
  f.store.db.prepare('INSERT INTO run_events VALUES(?,1,\'finished\',\'{}\',1)').run(f.runId)
  f.store.db.prepare('INSERT INTO execution_domains VALUES(?,?,1)').run(join(f.root, 'runs', f.runId, 'domain'), f.runId)
  const operation = randomUUID()
  f.store.db.prepare('INSERT INTO control_runs VALUES(?,?,\'pod\')').run(operation, f.runId)
  await f.retention.runs.prune()
  expect(f.store.db.prepare('SELECT * FROM control_runs').all()).toEqual([])
  expect(f.store.db.prepare('SELECT id FROM runs ORDER BY started_at,rowid').all().map(row => row.id)).toEqual(f.ids.slice(5))
  expect((await readdir(join(f.root, 'runs'))).sort()).toEqual(f.ids.slice(5).sort())
  expect({ pods: f.store.listPods(), checkpoint: f.store.checkpoint(f.pod.id), knowledge: f.store.knowledge(f.pod.id), schedules: f.store.db.prepare('SELECT * FROM schedules').all() }).toEqual(before)
  expect(await readFile(join(f.workspace, 'notes.txt'), 'utf8')).toBe('Durable workspace')
  expect(f.store.db.prepare('SELECT run_id,payload,state FROM accepted_events WHERE id=?').get(event)).toEqual({ run_id: null, payload: '{"body":"old input"}', state: 'processed' })
  const scheduler = new Scheduler(f.store, { start: () => { throw new Error('Must not replay processed input') } })
  expect(scheduler.acceptEvent(f.pod.id, 'manual', 'original', { body: 'old input' })).toBe(event)
  expect(() => scheduler.acceptEvent(f.pod.id, 'manual', 'original', {})).toThrow('conflicts')
  scheduler.drain()
  for (const table of ['run_inputs', 'run_events', 'execution_domains', 'run_deletion_jobs']) expect(f.store.db.prepare(`SELECT * FROM ${table}`).all()).toEqual([])
  expect(f.store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
})

it.each(['lease', 'pending', 'claimed', 'blocked', 'linkedInput', 'approval', 'unfinished', 'running'])('protects %s and prunes only after that protection is settled', async (protection) => {
  const f = await retentionFixture(); const db = f.store.db; const event = randomUUID()
  let settle: () => void
  if (protection === 'lease') {
    db.prepare('INSERT INTO run_leases VALUES(?,?,?,1,NULL)').run(f.pod.id, f.runId, 'old-boot')
    settle = () => { db.prepare('DELETE FROM run_leases').run() }
  }
  else if (['pending', 'claimed', 'blocked', 'linkedInput'].includes(protection)) {
    db.prepare('INSERT INTO accepted_events(id,pod_id,source,dedupe_key,payload,accepted_at,state,run_id) VALUES(?,?,\'manual\',?,\'{}\',1,?,?)').run(event, f.pod.id, event, protection === 'linkedInput' ? 'pending' : protection, protection === 'linkedInput' ? null : f.runId)
    db.prepare('INSERT INTO run_inputs(run_id,reason,event_ids) VALUES(?,\'manual\',?)').run(f.runId, JSON.stringify([event]))
    settle = () => { db.prepare('UPDATE accepted_events SET state=\'processed\'').run() }
  }
  else if (protection === 'approval') {
    db.prepare('INSERT INTO run_events VALUES(?,1,\'approval\',?,1)').run(f.runId, JSON.stringify({ grantId: 'grant', state: 'pending' }))
    settle = () => { db.prepare('INSERT INTO run_events VALUES(?,2,\'approval\',?,2)').run(f.runId, JSON.stringify({ grantId: 'grant', state: 'denied' })) }
  }
  else if (protection === 'running') {
    db.prepare('UPDATE runs SET state=\'running\' WHERE id=?').run(f.runId)
    settle = () => { db.prepare('UPDATE runs SET state=\'completed\' WHERE id=?').run(f.runId) }
  }
  else {
    db.prepare('UPDATE runs SET finished_at=NULL,state=\'interrupted\' WHERE id=?').run(f.runId)
    settle = () => { db.prepare('UPDATE runs SET finished_at=1,state=\'cancelled\' WHERE id=?').run(f.runId) }
  }
  await f.retention.runs.prune()
  expect(db.prepare('SELECT id FROM runs WHERE id=?').get(f.runId)?.id).toBe(f.runId)
  expect(await readFile(join(f.root, 'runs', f.runId, 'output.txt'), 'utf8')).toBe('Execution output')
  settle(); await f.retention.runs.prune()
  expect(db.prepare('SELECT id FROM runs WHERE id=?').get(f.runId)).toBeUndefined()
  await expect(lstat(join(f.root, 'runs', f.runId))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
})

it.each(['intent', 'unknown'])('prunes a run with an %s effect and an old recovery review together with both', async (state) => {
  const f = await retentionFixture(); const db = f.store.db
  db.prepare('INSERT INTO effect_ledger VALUES(?,?,?,?,?,?,NULL)').run(f.pod.id, 'delivery', 'http.request', digest('{}'), f.runId, state)
  db.prepare('INSERT INTO recovery_reviews VALUES(?,\'needsReview\',NULL,1,NULL)').run(f.runId)
  await f.retention.runs.prune()
  expect(db.prepare('SELECT id FROM runs WHERE id=?').get(f.runId)).toBeUndefined()
  expect(db.prepare('SELECT count(*) AS n FROM effect_ledger').get()!.n).toBe(0)
  expect(db.prepare('SELECT count(*) AS n FROM recovery_reviews').get()!.n).toBe(0)
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
})

it.each(['approved', 'denied', 'revoked'])('retains the latest %s grant reference until the same authorization scope has a newer reference', async (state) => {
  const f = await retentionFixture(60)
  const approval = { grantId: 'runtime-grant', state, permission: 'pod.execute', issuer: 'https://id.example', subject: 'owner' }
  const append = (runId: string, sequence: number, data: typeof approval) => {
    f.store.db.prepare('INSERT INTO run_events VALUES(?,?,\'approval\',?,?)').run(runId, sequence, JSON.stringify(data), sequence)
  }
  append(f.runId, 1, approval)
  append(f.ids[59]!, 2, { ...approval, permission: 'mail.read' })
  append(f.ids[59]!, 3, { ...approval, issuer: 'https://other.example' })
  append(f.ids[59]!, 4, { ...approval, subject: 'other-owner' })
  await f.retention.runs.prune()
  expect(f.store.db.prepare('SELECT data FROM run_events WHERE run_id=?').get(f.runId)?.data).toBe(JSON.stringify(approval))
  expect(f.store.db.prepare('SELECT id FROM runs').all()).toHaveLength(51)
  expect(await readFile(join(f.root, 'runs', f.runId, 'output.txt'), 'utf8')).toBe('Execution output')
  append(f.ids[59]!, 5, approval)
  await f.retention.runs.prune()
  expect(f.store.db.prepare('SELECT id FROM runs WHERE id=?').get(f.runId)).toBeUndefined()
  expect(f.store.db.prepare('SELECT id FROM runs').all()).toHaveLength(50)
  expect(f.store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
})

it('rolls back history and journal together when database deletion fails', async () => {
  const f = await retentionFixture()
  f.store.db.exec('CREATE TRIGGER fail_retention BEFORE DELETE ON runs BEGIN SELECT RAISE(ABORT,\'synthetic interruption\'); END;')
  await expect(f.retention.runs.prune()).rejects.toThrow('synthetic interruption')
  expect(f.store.db.prepare('SELECT id FROM runs').all()).toHaveLength(55)
  expect(f.store.db.prepare('SELECT * FROM run_deletion_jobs').all()).toEqual([])
  expect(await readdir(join(f.root, 'runs'))).toHaveLength(55)
  f.store.db.exec('DROP TRIGGER fail_retention')
  await f.retention.runs.prune()
  expect(f.store.db.prepare('SELECT id FROM runs').all()).toHaveLength(50)
})

it('finishes journaled folder deletion after restart without touching the Pod workspace', async () => {
  const f = await retentionFixture()
  vi.mocked(rm).mockRejectedValueOnce(Object.assign(new Error('Synthetic disk failure'), { code: 'EIO' }))
  await expect(f.retention.runs.prune()).rejects.toThrow('Synthetic disk failure')
  expect(f.store.db.prepare('SELECT id FROM runs').all()).toHaveLength(50)
  expect(f.store.db.prepare('SELECT * FROM run_deletion_jobs').all()).toHaveLength(5)
  expect((await f.retention.view()).pendingDeletion).toBe(5)
  f.store.close(); stores.splice(stores.indexOf(f.store), 1)
  const reopened = new PodDatabase(f.root); stores.push(reopened)
  await new DataRetention(reopened, 'unused-helper').cleanDeletedFiles()
  expect(reopened.db.prepare('SELECT * FROM run_deletion_jobs').all()).toEqual([])
  expect(await readdir(join(f.root, 'runs'))).toHaveLength(50)
  expect(await readFile(join(f.workspace, 'notes.txt'), 'utf8')).toBe('Durable workspace')
})

it('bounds a pass and resolves equal start times by insertion order', async () => {
  const f = await retentionFixture(110)
  f.store.db.prepare('UPDATE runs SET started_at=1').run()
  await Promise.all([f.retention.runs.prune(), f.retention.runs.prune()])
  expect(f.store.db.prepare('SELECT id FROM runs').all()).toHaveLength(85)
  await f.retention.runs.prune(); await f.retention.runs.prune()
  expect(f.store.db.prepare('SELECT id FROM runs ORDER BY rowid').all().map(row => row.id)).toEqual(f.ids.slice(60))
  expect(await readdir(join(f.root, 'runs'))).toHaveLength(50)
})

it('exports and restores detached receipts without resurrecting pruned runs', async () => {
  const f = await retentionFixture()
  f.store.db.prepare('INSERT INTO effect_ledger VALUES(?,?,?,?,?,\'completed\',?)').run(f.pod.id, 'delivery', 'http.request', digest('{}'), f.runId, '{"receipt":"confirmed"}')
  await f.retention.runs.prune()
  const backup = await createBackup(f.store, f.exports)
  const restored = new PodDatabase(await restoreBackup(backup, f.exports, schemaVersion)); stores.push(restored)
  expect(restored.db.prepare('SELECT * FROM runs').all()).toHaveLength(50)
  expect(restored.db.prepare('SELECT run_id,result FROM effect_ledger').get()).toEqual({ run_id: null, result: '{"receipt":"confirmed"}' })
  expect(restored.db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
})

it('refuses Pod deletion during active work', async () => {
  const { store, pod, runId } = await fixture()
  store.updatePod(pod.id, 1, { name: pod.name, lifecycle: 'archived' })
  const retention = new DataRetention(store, 'unused-helper')
  store.db.prepare('INSERT INTO run_leases VALUES(?,?,?,?,NULL)').run(pod.id, runId, 'synthetic-boot', Date.now())
  await expect(retention.deletePod(pod.id, 2, pod.name)).rejects.toThrow('active work')
  expect(store.getPod(pod.id).name).toBe(pod.name)
  expect(retention.jobs()).toEqual([])
})

it('round-trips shared data and fences claimed work, open effects and approvals until the owner reviews the restore', async () => {
  const { store, exports, pod, runId } = await fixture()
  const data = new DomainData(store)
  data.define({ path: 'synthetic/records', writer: 'owner', mode: 'records', readers: [pod.id] })
  data.set('owner', 'synthetic/records/one', { kept: true }, 0)
  store.db.prepare('INSERT INTO effect_attempts VALUES(?,1,?,?,\'mail.archive\',?,\'intent\',\'{}\',1)').run('a'.repeat(64), pod.id, runId, 'b'.repeat(64))
  store.db.prepare('INSERT INTO effect_receipts VALUES(?,1,1,\'intent\',\'{}\',1)').run('a'.repeat(64))
  const backup = await createBackup(store, exports)
  const restored = new PodDatabase(await restoreBackup(backup, exports, schemaVersion)); stores.push(restored)
  expect(new DomainData(restored).get('owner', 'synthetic/records/one')).toMatchObject({ value: { kept: true }, revision: 1 })
  expect(restored.db.prepare('SELECT state FROM effect_attempts').get()).toEqual({ state: 'unknown' })
  expect(restored.db.prepare('SELECT outcome FROM effect_receipts ORDER BY sequence').all()).toEqual([{ outcome: 'intent' }, { outcome: 'unknown' }])
  expect(restored.db.prepare('SELECT kind FROM storage_receipts').all()).toEqual([{ kind: 'restore' }])
  expect(() => restored.db.prepare('UPDATE pods SET lifecycle=\'active\' WHERE id=?').run(pod.id)).toThrow('Restored profile')
})

async function alterBackup(backup: string, sql: string) {
  const database = new DatabaseSync(join(backup, 'control.sqlite'))
  try { database.exec(sql) }
  finally { database.close() }
  const manifest = JSON.parse(await readFile(join(backup, 'backup.json'), 'utf8'))
  const bytes = await readFile(join(backup, 'control.sqlite'))
  const file = manifest.files.find((file: { path: string }) => file.path === 'control.sqlite'); file.size = bytes.length; file.hash = digest(bytes)
  await writeFile(join(backup, 'backup.json'), JSON.stringify(manifest))
}

it.each([
  ['DROP INDEX effect_execution_guard', 'altered storage'],
  ['DROP TABLE data_readers', 'altered storage'],
  ['CREATE TRIGGER malicious AFTER UPDATE ON pods BEGIN SELECT 1; END', 'unsupported database programs'],
])('rejects a modified schema despite updated portable checksums: %s', async (sql, reason) => {
  const { store, exports } = await fixture()
  const backup = await createBackup(store, exports); const before = await readdir(exports)
  await alterBackup(backup, sql)
  await expect(restoreBackup(backup, exports, schemaVersion)).rejects.toThrow(reason)
  expect(await readdir(exports)).toEqual(before)
})

it('protects the writer of shared data and a Pod with uncertain actions from deletion', async () => {
  const { store, pod } = await fixture()
  store.db.prepare('UPDATE pods SET lifecycle=\'archived\' WHERE id=?').run(pod.id)
  const retention = new DataRetention(store, '/unused/helper')
  new DomainData(store).define({ path: 'synthetic/results', writer: pod.id, mode: 'results' })
  await expect(retention.deletePod(pod.id, 1, pod.name)).rejects.toThrow('writes shared data')
  store.db.prepare('UPDATE data_namespaces SET writer=\'owner\',mode=\'records\'').run()
  store.db.prepare('INSERT INTO effect_attempts VALUES(?,1,?,NULL,\'mail.archive\',?,\'unknown\',\'{}\',1)').run('a'.repeat(64), pod.id, 'b'.repeat(64))
  await expect(retention.deletePod(pod.id, 1, pod.name)).rejects.toThrow('uncertain actions')
})

it('keeps abandoned plaintext stages local and removes them before the worker resumes', async () => {
  const { store, exports } = await fixture(); const staging = await encryptedBackupStaging(store.root)
  const abandoned = join(staging, `.seal-source-${randomUUID()}`); await mkdir(abandoned); await writeFile(join(abandoned, 'private.txt'), 'synthetic private data')
  expect(staging.startsWith(exports)).toBe(false)
  await cleanupEncryptedBackupStaging(store.root)
  expect(await readdir(staging)).toEqual([])
  expect(await readdir(exports)).toEqual([])
  expect((await lstat(staging)).mode & 0o777).toBe(0o700)
})

it('removes all recognized plaintext stages before reporting foreign staging entries', async () => {
  const { store } = await fixture(); const staging = await encryptedBackupStaging(store.root)
  await writeFile(join(staging, '.DS_Store'), 'synthetic Finder metadata')
  await writeFile(join(staging, 'unknown-entry'), 'inspect this unexpected entry')
  const abandoned = join(staging, `.unseal-${randomUUID()}`); await mkdir(abandoned); await writeFile(join(abandoned, 'private.txt'), 'private')
  await expect(cleanupEncryptedBackupStaging(store.root)).rejects.toThrow('Unsupported encrypted backup staging entry')
  expect((await readdir(staging)).sort()).toEqual(['.DS_Store', 'unknown-entry'])
  await rm(join(staging, 'unknown-entry')); await cleanupEncryptedBackupStaging(store.root)
})
