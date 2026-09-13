// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { digest, parseManifest, PodDatabase } from '../../src/worker/storage/database'
import type { CommitPoint, ProgressInput, ScriptManifest } from '../../src/worker/storage/database'

const roots: string[] = []; const stores: PodDatabase[] = []
function fixture(): PodDatabase {
  const root = mkdtempSync(join(tmpdir(), 'pods-storage-')); roots.push(root)
  const store = new PodDatabase(root); stores.push(store); return store
}
function reopen(store: PodDatabase): PodDatabase {
  store.close(); stores.splice(stores.indexOf(store), 1)
  const next = new PodDatabase(store.root); stores.push(next); return next
}
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function progress(podId: string): ProgressInput {
  return { podId, expectedRevision: 0, checkpoint: { cursor: 'page-2' }, sources: [{ id: 'message-1', version: 'v1', locator: 'fixture://mail/1', content: 'Delivery confirmed for Monday.' }], claims: [{ id: 'claim-1', matter: 'order-1', kind: 'finding', text: 'Delivery is confirmed for Monday.', sourceIds: ['message-1'] }] }
}
function manifest(artifact: string): ScriptManifest {
  return { schemaVersion: 1, contentHash: digest(artifact), entrypoint: 'run.mjs', dependencyLockHash: digest('empty'), runtimeVersion: 'node24', capabilities: [], triggers: ['manual'], inputSchemaHash: digest('input'), outputSchemaHash: digest('output'), checkpointSchemaVersion: 1, assignmentRevision: 1, effects: 'readOnly' }
}
describe('durable pod state', () => {
  it('creates a manual-only pod, persists edits and rejects stale/excess authority', () => {
    let store = fixture()
    expect(() => store.createPod({ name: 'Mail', assignment: 'Read', token: 'never-store' })).toThrow('schema')
    const pod = store.createPod({ name: 'Mail', assignment: 'Read assigned mail.' })
    expect(pod.lifecycle).toBe('paused'); expect(pod.activeScript).toBeNull()
    store.updatePod(pod.id, 1, { name: 'Knowledge', assignment: 'Read selected folders.', lifecycle: 'paused' })
    expect(() => store.updatePod(pod.id, 1, { name: 'Stale', assignment: 'Overwrite', lifecycle: 'active' })).toThrow('Stale')
    store = reopen(store)
    expect(store.getPod(pod.id)).toMatchObject({ name: 'Knowledge', revision: 2, assignment: 'Read selected folders.' })
    expect(store.db.prepare('SELECT count(*) AS count FROM assignments').get()?.count).toBe(2)
  })
  it('pins artifact bytes and immutable manifests without activating drafts', () => {
    const store = fixture(); const pod = store.createPod({ name: 'Pod', assignment: 'Read' })
    const artifact = 'export async function run() { return { status: "completed" } }'
    const contract = manifest(artifact)
    expect(() => store.storeScript(pod.id, contract, 'tampered')).toThrow('hash mismatch')
    store.storeScript(pod.id, contract, artifact)
    expect(store.readBlob(contract.contentHash).toString()).toBe(artifact)
    expect(() => store.storeScript(pod.id, { ...contract, capabilities: ['mail.read'] }, artifact)).toThrow('Immutable')
    expect(() => parseManifest({ ...contract, environment: { SECRET: 'bad' } })).toThrow('schema')
    expect(store.getPod(pod.id).activeScript).toBeNull()
  })
  it('commits cited knowledge and checkpoint together and retains supersession history', () => {
    let store = fixture(); const pod = store.createPod({ name: 'Pod', assignment: 'Read' })
    const unit = progress(pod.id); store.commitProgress(unit)
    expect(() => store.commitProgress(unit)).toThrow('Stale')
    store = reopen(store)
    expect(store.checkpoint(pod.id)).toEqual({ revision: 1, body: { cursor: 'page-2' } })
    const citation = (store.knowledge(pod.id)[0]!.citations as { hash: string }[])[0]!
    expect(store.readBlob(citation.hash).toString()).toBe(unit.sources[0]!.content)
    store.commitProgress({ ...unit, expectedRevision: 1, sources: [{ ...unit.sources[0]!, version: 'v2', content: 'Delivery moved to Tuesday.' }], claims: [{ ...unit.claims[0]!, id: 'claim-2', text: 'Delivery is Tuesday.', supersedes: 'claim-1' }] })
    expect(store.knowledge(pod.id)).toHaveLength(2)
    expect(store.knowledge(pod.id)[0]!.citations).toEqual([expect.objectContaining({ version: 'v1' })])
    expect(store.knowledge(pod.id)[1]!.supersedes).toBe('claim-1')
  })
  it('rejects unavailable citations and source conflicts without advancing progress', () => {
    const store = fixture(); const pod = store.createPod({ name: 'Pod', assignment: 'Read' }); const unit = progress(pod.id)
    expect(() => store.commitProgress({ ...unit, claims: [{ ...unit.claims[0]!, sourceIds: ['missing'] }] })).toThrow('unavailable')
    expect(store.checkpoint(pod.id).revision).toBe(0)
    expect(store.db.prepare('SELECT count(*) AS count FROM sources').get()?.count).toBe(0)
    store.commitProgress(unit)
    expect(() => store.commitProgress({ ...unit, expectedRevision: 1, sources: [{ ...unit.sources[0]!, content: 'Different content under same version' }] })).toThrow('conflict')
    expect(store.checkpoint(pod.id).revision).toBe(1)
  })
  it.each<CommitPoint>(['staged', 'renamed', 'beforeCommit', 'committed'])('survives actual process death at %s without half a checkpoint', (point) => {
    let store = fixture(); const pod = store.createPod({ name: 'Pod', assignment: 'Read' }); const unit = progress(pod.id)
    const source = resolve('src/worker/storage/database.ts')
    const code = `import { PodDatabase } from ${JSON.stringify(source)}; const store = new PodDatabase(${JSON.stringify(store.root)}); store.commitProgress(${JSON.stringify(unit)}, point => { if (point === ${JSON.stringify(point)}) process.kill(process.pid, 'SIGKILL') });`
    const child = spawnSync(process.execPath, ['--experimental-transform-types', '--input-type=module', '-e', code], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } })
    expect(child.signal, child.stderr).toBe('SIGKILL')
    store = reopen(store)
    expect(store.checkpoint(pod.id).revision).toBe(point === 'committed' ? 1 : 0)
    expect(store.knowledge(pod.id)).toHaveLength(point === 'committed' ? 1 : 0)
    if (point === 'committed') expect(store.readBlob(digest(unit.sources[0]!.content)).toString()).toBe(unit.sources[0]!.content)
  })
  it('backs up and migrates a v1 database with existing pod state', () => {
    let store = fixture(); const pod = store.createPod({ name: 'Previous', assignment: 'Preserve me' })
    store.db.exec('DROP TABLE settings; DROP TABLE validations; PRAGMA user_version=1')
    store = reopen(store)
    expect(store.getPod(pod.id).assignment).toBe('Preserve me')
    expect(store.db.prepare('SELECT concurrency FROM settings').get()?.concurrency).toBe(2)
    const backups = readdirSync(store.root).filter(file => file.startsWith('before-v1-'))
    expect(backups).toHaveLength(1)
    const backup = new DatabaseSync(join(store.root, backups[0]!), { readOnly: true })
    try { expect(backup.prepare('PRAGMA user_version').get()?.user_version).toBe(1); expect(backup.prepare('SELECT name FROM pods').get()?.name).toBe('Previous') }
    finally { backup.close() }
  })
  it('rejects a future database without modifying its bytes', () => {
    const store = fixture(); store.db.exec('PRAGMA user_version=999'); store.close(); stores.splice(stores.indexOf(store), 1)
    const before = readFileSync(store.path)
    expect(() => new PodDatabase(store.root)).toThrow('newer application')
    expect(readFileSync(store.path)).toEqual(before)
  })
})
