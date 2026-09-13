// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PodDatabase } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'

const roots: string[] = []; const stores: PodDatabase[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
describe('pod resource registry', () => {
  it('starts empty, scopes assignments to one pod and fences affected execution on revocation', () => {
    const root = mkdtempSync(join(tmpdir(), 'pods-resource-db-')); roots.push(root)
    const store = new PodDatabase(root); stores.push(store)
    const a = store.createPod({ name: 'A', assignment: 'Read A' }); const b = store.createPod({ name: 'B', assignment: 'Read B' })
    const stop = vi.fn(); const registry = new ResourceRegistry(store, stop)
    expect(registry.list(a.id)).toEqual([]); expect(registry.epoch(a.id)).toBe(0)
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
