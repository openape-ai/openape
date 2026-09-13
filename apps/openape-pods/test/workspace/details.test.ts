// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PodDatabase } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { WorkspaceDetails } from '../../src/worker/workspace/details'
import { RunStore } from '../../src/worker/runs/store'
import { installExample } from '../../src/worker/runs/examples'
import { parseDetailsCommand } from '../../src/contracts/details'

const stores: PodDatabase[] = []; const roots: string[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pods-details-')); roots.push(root)
  const store = new PodDatabase(root); stores.push(store)
  const pod = store.createPod({ name: 'Orders', assignment: 'Read assigned synthetic orders' }); const resources = new ResourceRegistry(store, () => {})
  return { store, pod, resources, details: new WorkspaceDetails(store, resources) }
}
describe('pod details and version controls', () => {
  it('retains exact historical evidence and counts only current claims', () => {
    const f = fixture()
    for (const revision of [0, 1]) f.store.commitProgress({ podId: f.pod.id, expectedRevision: revision, checkpoint: {}, sources: [{ id: 'source', version: String(revision), locator: 'fixture:order', content: revision ? 'Due Tuesday' : 'Due Monday' }], claims: [{ id: `claim-${revision}`, matter: 'Order', kind: 'finding', text: revision ? 'Tuesday' : 'Monday', sourceIds: ['source'], ...(revision ? { supersedes: 'claim-0' } : {}) }] })
    const view = f.details.execute({ type: 'list', podId: f.pod.id })
    expect(view.counts).toEqual({ finding: 1, question: 0, gap: 0 }); expect(view.total).toBe(2)
    expect(view.claims.map(claim => claim.current)).toEqual([true, false])
    expect(f.details.execute({ type: 'source', podId: f.pod.id, id: 'source', version: '0' }).source?.content).toBe('Due Monday')
    const foreign = f.store.createPod({ name: 'Other', assignment: 'No source permission' })
    expect(() => f.details.execute({ type: 'source', podId: foreign.id, id: 'source', version: '0' })).toThrow('not assigned')
    expect(() => parseDetailsCommand({ type: 'source', podId: f.pod.id, path: '/private', id: 'source', version: '0' })).toThrow('scope')
  })
  it('activates retained validated versions while a run retains its original hash', () => {
    const f = fixture(); installExample(f.store, f.resources, f.pod.id, 'deterministic', 'a'.repeat(64))
    const first = f.store.getPod(f.pod.id).activeScript!
    installExample(f.store, f.resources, f.pod.id, 'agent', 'a'.repeat(64)); const second = f.store.getPod(f.pod.id).activeScript!
    const runs = new RunStore(f.store); const run = runs.reserve(f.pod.id, second, 0).run
    const command = { type: 'activate' as const, podId: f.pod.id, hash: first, expectedActive: second, assignmentRevision: 1 }
    f.details.execute(command)
    expect(f.store.getPod(f.pod.id).activeScript).toBe(first); expect(runs.get(run.id).scriptHash).toBe(second)
    expect(() => f.details.execute(command)).toThrow('changed')
    f.resources.assignReference(f.pod.id, 'Reference', join(f.store.root, 'assigned.txt'))
    expect(() => f.details.execute({ ...command, expectedActive: first })).toThrow('Validate')
  })
  it('denies activation after assignment or archival changes', () => {
    const f = fixture(); installExample(f.store, f.resources, f.pod.id, 'deterministic', 'a'.repeat(64)); const hash = f.store.getPod(f.pod.id).activeScript!
    f.store.updatePod(f.pod.id, 1, { name: 'Changed', assignment: 'Changed scope', lifecycle: 'archived' })
    expect(() => f.details.execute({ type: 'activate', podId: f.pod.id, hash, expectedActive: hash, assignmentRevision: 1 })).toThrow('changed')
  })
})
