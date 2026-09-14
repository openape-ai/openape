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
import { DataRetention } from '../../src/worker/data/retention'

const stores: PodDatabase[] = []; const roots: string[] = []
afterEach(async () => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'Pods Müller backup '))); roots.push(base)
  const root = join(base, 'profile'); const exports = join(base, 'exports'); await mkdir(exports)
  const store = new PodDatabase(root); stores.push(store)
  const pod = store.createPod({ name: 'Orders', assignment: 'Read only synthetic evidence' })
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
  const backup = await createBackup(store, exports); const target = await restoreBackup(backup, exports, schemaVersion)
  const restored = new PodDatabase(target); stores.push(restored)
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
  store.updatePod(pod.id, 1, { name: pod.name, assignment: pod.assignment, lifecycle: 'archived' })
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
