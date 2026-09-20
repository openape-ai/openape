// @vitest-environment node
import { mkdtemp, mkdir, lstat, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it } from 'vitest'
import { PodDatabase, digest, schemaVersion } from '../../src/worker/storage/database'
import { createBackup, restoreBackup } from '../../src/worker/data/backup'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { PodGroups } from '../../src/worker/workspace/groups'
import { storageBytes } from '../../src/worker/data/files'
import { ChatRegistry } from '../../src/worker/master/chat-registry'
import { MasterConversations } from '../../src/worker/master/conversations'
import { ControlChanges } from '../../src/worker/control/changes'
import { DataRetention } from '../../src/worker/data/retention'

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
  const groups = new PodGroups(store); groups.execute({ type: 'organize', action: 'create', revision: 1, name: 'Clients' }); groups.execute({ type: 'organize', action: 'move', revision: 2, podId: pod.id, groupId: groups.view().groups[0]!.id })
  new ResourceRegistry(store, () => {}).assignCredential(pod.id, 'crm', randomUUID(), 0)
  store.db.prepare('INSERT INTO script_credential_approvals VALUES(?,?,?,?)').run(pod.id, store.getPod(pod.id).activeScript!, 1, 1)
  store.db.prepare('INSERT INTO pod_variables VALUES(?,?,?,?)').run(pod.id, 'topic', 'Orders', 1)
  store.db.prepare('INSERT INTO master_contexts VALUES(?,?,?,?)').run(pod.id, 'old-thread', 'idle', null)
  const backup = await createBackup(store, exports); const target = await restoreBackup(backup, exports, schemaVersion)
  const restored = new PodDatabase(target); stores.push(restored)
  expect(restored.db.prepare('SELECT value FROM pod_variables WHERE pod_id=?').get(pod.id)?.value).toBe('Orders')
  expect(restored.db.prepare('SELECT thread_id,state FROM master_contexts WHERE scope=?').get(pod.id)).toMatchObject({ thread_id: null, state: 'interrupted' })
  expect(new PodGroups(restored).view()).toEqual(groups.view())
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
it('preserves remote ownership but fences transport and reviews after restoring without credentials', async () => {
  const { store, exports, pod } = await fixture()
  const owner = JSON.stringify({ issuer: 'https://id.example', subject: 'owner@example.test' })
  const identity = JSON.stringify({ subject: 'existing-agent@example.test', keyId: 'original-key' })
  store.db.prepare('INSERT INTO remote_pods VALUES(?,?,?,?,?,?,NULL)').run(pod.id, owner, randomUUID(), randomUUID(), 'ready', identity)
  store.db.prepare('INSERT INTO remote_registration VALUES(1,?,1)').run('{}')
  store.db.prepare('INSERT INTO remote_devices VALUES(?,?,?,?,0)').run(randomUUID(), owner, '{}', 1)
  store.db.prepare('INSERT INTO remote_program_catalog VALUES(?,?,?,?,0)').run(randomUUID(), owner, '{}', 'synthetic-hash')
  store.db.prepare('INSERT INTO remote_program_reviews VALUES(?,?,?)').run(randomUUID(), pod.id, '{}')
  const operation = randomUUID()
  store.db.prepare('INSERT INTO remote_inbox VALUES(?,?,?,?,?,NULL,NULL,?)').run(operation, 'synthetic-hash', randomUUID(), '{}', 'received', Date.now())
  store.db.prepare('INSERT INTO remote_outbox(id,operation_id,device_id,route,body) VALUES(?,?,?,?,?)').run(operation, operation, randomUUID(), '{}', '{}')
  const backup = await createBackup(store, exports)
  const restored = new PodDatabase(await restoreBackup(backup, exports, schemaVersion)); stores.push(restored)
  expect(restored.db.prepare('SELECT owner,identity,phase FROM remote_pods').get()).toMatchObject({ owner, identity, phase: 'needs_desktop_action' })
  for (const table of ['remote_registration', 'remote_devices', 'remote_outbox', 'remote_program_reviews']) expect(restored.db.prepare(`SELECT * FROM ${table}`).all()).toEqual([])
  expect(restored.db.prepare('SELECT revoked FROM remote_program_catalog').get()?.revoked).toBe(1)
  expect(restored.db.prepare('SELECT state FROM remote_inbox').get()?.state).toBe('unknown')
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
it('restores partial workflow history paused while retaining effect receipts and completed nodes', async () => {
  const { store, exports, pod, runId } = await fixture()
  const workflowId = randomUUID(); const workflowRun = randomUUID()
  const nodes = [{ podId: pod.id, after: [], handoff: false }]
  const definition = { id: workflowId, revision: 1, name: 'Partial synthetic workflow', nodes, enabled: true, paused: false, schedule: { kind: 'interval', seconds: 60 }, nextAt: 1000 }
  store.db.prepare('INSERT INTO workflows(id,revision,name,nodes,schedule,enabled,paused) VALUES(?,1,?,?,?,1,0)').run(workflowId, definition.name, JSON.stringify(nodes), JSON.stringify(definition.schedule))
  store.db.prepare('INSERT INTO workflow_runs(id,workflow_id,revision,definition,trigger,state,started_at) VALUES(?,?,1,?,\'manual\',\'blocked\',1000)').run(workflowRun, workflowId, JSON.stringify(definition))
  store.db.prepare('INSERT INTO workflow_nodes VALUES(?,?,?,?,?,\'completed\',?,NULL,?)').run(workflowRun, pod.id, store.getPod(pod.id).activeScript, 1, 0, runId, JSON.stringify({ schema: 'synthetic/v1', data: { receipt: 'confirmed' } }))
  store.db.prepare('INSERT INTO workflow_attempts VALUES(?,?,?)').run(runId, workflowRun, pod.id)
  store.db.prepare('INSERT INTO effect_ledger VALUES(?,?,?,?,?,\'completed\',?)').run(pod.id, 'synthetic-effect', 'mail.telegram', digest('synthetic'), runId, JSON.stringify({ state: 'confirmed', receipt: { messageId: 42 } }))
  store.db.prepare('INSERT INTO workflow_mail_scopes(id,mailbox,baseline_at) VALUES(?,?,?)').run('synthetic-scope', 'owner@example.invalid', 1000)
  const backup = await createBackup(store, exports); const target = await restoreBackup(backup, exports, schemaVersion)
  const restored = new PodDatabase(target); stores.push(restored)
  expect(restored.db.prepare('SELECT restored FROM workflow_mail_scopes').get()!.restored).toBe(1)
  expect(restored.db.prepare('SELECT enabled,paused FROM workflows').get()).toMatchObject({ enabled: 0, paused: 1 })
  expect(restored.db.prepare('SELECT paused,reason FROM workflow_runs').get()).toMatchObject({ paused: 1, reason: 'Restored workflow requires review' })
  expect(restored.db.prepare('SELECT state,output FROM workflow_nodes').get()).toMatchObject({ state: 'completed', output: JSON.stringify({ schema: 'synthetic/v1', data: { receipt: 'confirmed' } }) })
  expect(JSON.parse(restored.db.prepare('SELECT result FROM effect_ledger').get()!.result as string)).toEqual({ state: 'confirmed', receipt: { messageId: 42 } })
})

it('retains original and shared conversations after Pod deletion with an unavailable target', async () => {
  const { store, pod } = await fixture(); const registry = new ChatRegistry(store); const conversations = new MasterConversations(store)
  const original = registry.ensure(pod.id); const id = randomUUID()
  registry.execute({ type: 'create', id, title: 'Shared work', podIds: [pod.id], workflowId: null, workflowRevision: null })
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

it('restores chat history while discarding pending changes and every provider continuation', async () => {
  const { store, pod, exports } = await fixture(); const registry = new ChatRegistry(store); const chat = registry.ensure(pod.id)
  const messageId = randomUUID(); store.db.prepare('INSERT INTO master_messages VALUES(?,?,?,?,?)').run(messageId, 'user', 'Saved history', 'sent', 1)
  new MasterConversations(store).assign(messageId, chat.scope)
  store.db.prepare('INSERT OR REPLACE INTO master_contexts VALUES(?,?,?,?)').run(chat.scope, 'old-provider-thread', 'idle', null)
  const changes = new ControlChanges(store, new ResourceRegistry(store, () => {}))
  changes.prepare(chat, { action: 'setVariable', podId: pod.id, revision: 1, name: 'topic', value: 'new', variableRevision: 0 })
  const backup = await createBackup(store, exports); const target = await restoreBackup(backup, exports, schemaVersion)
  const restored = new PodDatabase(target); stores.push(restored)
  expect(new MasterConversations(restored).messages(chat.scope)[0]?.text).toBe('Saved history')
  expect(new MasterConversations(restored).session(chat.scope).threadId).toBeNull()
  expect(new ControlChanges(restored, new ResourceRegistry(restored, () => {})).list(chat.id)[0]?.state).toBe('discarded')
})
