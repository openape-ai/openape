import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PodDatabase } from '../src/worker/storage/database'
import { ResourceRegistry } from '../src/worker/resources/registry'
import { RunDispatcher } from '../src/worker/runs/dispatcher'

let store: PodDatabase | undefined
let dispatcher: RunDispatcher | undefined
let root = ''
afterEach(async () => { await dispatcher?.stop(); store?.close(); if (root) await rm(root, { recursive: true, force: true }) })
async function setup() {
  root = await realpath(await mkdtemp(join(tmpdir(), 'pods-dispatch-')))
  store = new PodDatabase(root)
  const resources = new ResourceRegistry(store, id => dispatcher?.cancelPod(id))
  dispatcher = new RunDispatcher(store, resources, { helper: resolve('dist/native/pods-helper'), executable: process.execPath, entry: resolve('dist/runtime/script-entry.mjs'), runtimeDirectories: [], environment: {}, binary: resolve('dist/vendor/codex'), catalog: resolve('dist/vendor/models.json'), manifest: resolve('dist/vendor/manifest.json'), sdkHost: resolve('dist/runtime/sdk-host.mjs') })
  return { store, dispatcher, resources, pod: store.createPod({ name: 'Synthetic pod', assignment: 'Run local synthetic scripts only.' }) }
}
describe('manual dispatch', () => {
  it('pins the version, shares one lease, persists acknowledged progress and replays ordered events', async () => {
    const { store, dispatcher, pod } = await setup()
    await dispatcher.install(pod.id, 'deterministic')
    const id = dispatcher.start(pod.id)
    expect(dispatcher.start(pod.id)).toBe(id)
    await expect.poll(() => dispatcher.runs.get(id).state).toBe('completed')
    expect(store.checkpoint(pod.id)).toMatchObject({ revision: 1, body: { exampleRuns: 1 } })
    const events = dispatcher.view(pod.id, id).events
    expect(events.map(event => event.sequence)).toEqual(events.map((_event, i) => i + 1))
    expect(events.map(event => event.type)).toContain('checkpoint')
    expect(dispatcher.view(pod.id, id, events[1]!.sequence).events).toEqual(events.slice(2))
    const next = dispatcher.start(pod.id)
    await expect.poll(() => dispatcher.runs.get(next).state).toBe('completed')
    expect(store.checkpoint(pod.id)).toMatchObject({ revision: 2, body: { exampleRuns: 2 } })
  })
  it('makes provider absence visible without committing progress or reporting success', async () => {
    const { store, dispatcher, pod } = await setup()
    await dispatcher.install(pod.id, 'agent')
    const id = dispatcher.start(pod.id)
    await expect.poll(() => dispatcher.runs.get(id).state).toBe('failed')
    expect(dispatcher.runs.get(id).error).toContain('Codex is not connected')
    expect(store.checkpoint(pod.id).revision).toBe(0)
  })
  it('rejects stale validation after resource assignment changes', async () => {
    const { dispatcher, resources, pod } = await setup()
    await dispatcher.install(pod.id, 'deterministic')
    resources.assignReference(pod.id, 'Synthetic', join(root, 'not-yet-created.txt'))
    expect(() => dispatcher.start(pod.id)).toThrow('validation')
    expect(dispatcher.view(pod.id).runs).toHaveLength(0)
  })
})
