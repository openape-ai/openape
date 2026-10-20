// @vitest-environment node
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PodDatabase } from '../../src/worker/storage/database'
import { assignedDirectories } from '../../src/runtime/directories'
import { parseResourceCommand } from '../../src/contracts/resources'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { setMandatorySecretPaths } from '../../src/runtime/secret-paths'

const roots: string[] = []; const stores: PodDatabase[] = []
afterEach(() => { setMandatorySecretPaths([]); for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
describe('pod resource registry', () => {
  it('starts empty, scopes assignments to one pod and fences affected execution on revocation', () => {
    const root = mkdtempSync(join(tmpdir(), 'pods-resource-db-')); roots.push(root)
    const store = new PodDatabase(root); stores.push(store)
    const a = store.createPod({ name: 'A' }); const b = store.createPod({ name: 'B' })
    const stop = vi.fn(); const registry = new ResourceRegistry(store, stop)
    expect(registry.list(a.id)).toEqual([]); expect(registry.epoch(a.id)).toBe(0)
    setMandatorySecretPaths(['/synthetic/agent-backends.json'])
    expect(() => registry.assignReference(a.id, 'Runtime config', '/synthetic/agent-backends.json')).toThrow('cannot be assigned to a Pod')
    expect(registry.list(a.id)).toEqual([]); expect(registry.epoch(a.id)).toBe(0); expect(stop).not.toHaveBeenCalled()
    const resource = registry.assignReference(a.id, 'Reference', '/synthetic/assigned.txt')
    expect(registry.list(b.id)).toEqual([])
    expect(registry.epoch(a.id)).toBe(1); expect(stop).toHaveBeenCalledWith(a.id)
    expect(() => registry.revoke(b.id, resource.id, resource.revision)).toThrow('Stale')
    registry.assertCurrent(a.id, 1); registry.revoke(a.id, resource.id, 1)
    expect(() => registry.assertCurrent(a.id, 1)).toThrow('permissions changed')
    expect(registry.list(a.id)[0]!.state).toBe('revoked')
    expect(() => registry.revoke(a.id, resource.id, 1)).toThrow('Stale')
  })
})

it('persists direct directory permissions, fences changes and rejects replaced or protected paths', async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'pods-directory-db-'))); roots.push(base)
  const root = join(base, 'profile'); const path = join(base, 'documents')
  mkdirSync(root); mkdirSync(path)
  const store = new PodDatabase(root); stores.push(store)
  const pod = store.createPod({ name: 'Directories' }); const other = store.createPod({ name: 'Other' })
  const stop = vi.fn(); const registry = new ResourceRegistry(store, stop)
  await registry.assignDirectory(pod.id, path, 'read', 0)
  const resource = registry.list(pod.id)[0]!
  expect(resource).toMatchObject({ kind: 'directory', name: 'documents', configuration: { path, access: 'read' } })
  expect(await assignedDirectories(root, other.id, registry.list(pod.id))).toEqual([])
  expect(await assignedDirectories(root, pod.id, registry.list(pod.id))).toHaveLength(1)
  await expect(registry.assignDirectory(pod.id, path, 'readWrite', 0)).rejects.toThrow('changed')
  await registry.assignDirectory(pod.id, path, 'readWrite', 1)
  expect(registry.list(pod.id)[0]).toMatchObject({ id: resource.id, revision: 2, configuration: { access: 'readWrite' } })
  expect(stop).toHaveBeenCalledTimes(2)
  expect(() => registry.assertCurrent(pod.id, 1)).toThrow('changed')
  await expect(registry.assignDirectory(pod.id, root, 'read', 2)).rejects.toThrow('protected')
  await expect(registry.assignDirectory(pod.id, base, 'readWrite', 2)).rejects.toThrow('protected')
  const alias = join(base, 'alias'); symlinkSync(path, alias)
  await expect(registry.assignDirectory(pod.id, alias, 'read', 2)).rejects.toThrow('symbolic')
  renameSync(path, join(base, 'original')); mkdirSync(path)
  await expect(assignedDirectories(root, pod.id, registry.list(pod.id))).rejects.toThrow('changed')
  registry.revoke(pod.id, resource.id, 2)
  expect(await assignedDirectories(root, pod.id, registry.list(pod.id))).toEqual([])
  expect(() => parseResourceCommand({ type: 'assignDirectory', podId: pod.id, path, access: 'readWrite', epoch: 3 })).toThrow('Unsupported')
  expect(() => parseResourceCommand({ type: 'pickDirectory', podId: pod.id, path, epoch: 3 })).toThrow('Unsupported')
})

it('keeps repeated captures without references entirely in memory', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pods-empty-capture-')); roots.push(root)
  const store = new PodDatabase(root); stores.push(store)
  const pod = store.createPod({ name: 'No references' })
  const registry = new ResourceRegistry(store, () => {})
  for (let attempt = 0; attempt < 2; attempt++) expect((await registry.capture(pod.id, '/missing-helper')).files).toEqual([])
  expect(store.db.prepare('SELECT count(*) AS count FROM snapshot_sets').get()!.count).toBe(0)
  const { existsSync } = await import('node:fs')
  expect(existsSync(join(root, 'snapshots'))).toBe(false)
})

it('removes only empty snapshot manifests, resumes missing files and preserves actual data', async () => {
  const { cleanEmptySnapshots } = await import('../../src/worker/resources/empty-snapshots')
  const { randomUUID } = await import('node:crypto')
  const { existsSync, writeFileSync } = await import('node:fs')
  const root = mkdtempSync(join(tmpdir(), 'pods-empty-cleanup-')); roots.push(root)
  const store = new PodDatabase(root); stores.push(store)
  const pod = store.createPod({ name: 'References' })
  const entries = ['empty', 'missing', 'nonempty', 'unexpected', 'symlink'].map(kind => ({ kind, id: randomUUID() }))
  for (const { kind, id } of entries) {
    const path = join(root, 'snapshots', pod.id, id)
    const manifest = { id, files: kind === 'nonempty' ? [{ content: 'retained' }] : [] }
    store.db.prepare('INSERT INTO snapshot_sets VALUES(?,?,0,?)').run(id, pod.id, JSON.stringify(manifest))
    if (kind === 'missing') continue
    if (kind === 'symlink') { symlinkSync(join(root, 'snapshots', pod.id, entries[0]!.id), path); continue }
    mkdirSync(path, { recursive: true }); writeFileSync(join(path, 'manifest.json'), JSON.stringify(manifest))
    if (kind === 'unexpected') writeFileSync(join(path, 'keep.txt'), 'Preserve unknown contents')
  }
  expect(await cleanEmptySnapshots(store)).toBe(2)
  expect(await cleanEmptySnapshots(store)).toBe(0)
  expect(store.db.prepare('SELECT count(*) AS count FROM snapshot_sets').get()!.count).toBe(3)
  for (const { kind, id } of entries.filter(entry => ['nonempty', 'unexpected'].includes(entry.kind))) {
    expect(existsSync(join(root, 'snapshots', pod.id, id, kind === 'unexpected' ? 'keep.txt' : 'manifest.json'))).toBe(true)
  }
})
