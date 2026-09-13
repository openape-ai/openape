import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PodDatabase } from '../src/worker/storage/database'
import { ResourceRegistry } from '../src/worker/resources/registry'
import { RunDispatcher } from '../src/worker/runs/dispatcher'
import { Scheduler } from '../src/worker/scheduling/scheduler'
import { ReferenceWatcher } from '../src/worker/scheduling/references'

let store: PodDatabase | undefined
let dispatcher: RunDispatcher | undefined
let root = ''
afterEach(async () => { await dispatcher?.stop(); store?.close(); if (root) await rm(root, { recursive: true, force: true }) })
async function setup() {
  root = await realpath(await mkdtemp(join(tmpdir(), 'pods-scheduling-')))
  store = new PodDatabase(root)
  const resources = new ResourceRegistry(store, id => dispatcher?.cancelPod(id))
  const helper = resolve('dist/native/pods-helper')
  dispatcher = new RunDispatcher(store, resources, { helper, executable: process.execPath, entry: resolve('dist/runtime/script-entry.mjs'), runtimeDirectories: [], environment: {}, binary: resolve('dist/vendor/codex'), catalog: resolve('dist/vendor/models.json'), manifest: resolve('dist/vendor/manifest.json'), sdkHost: resolve('dist/runtime/sdk-host.mjs') })
  let now = 1000
  const scheduler = new Scheduler(store, dispatcher, () => now)
  const watcher = new ReferenceWatcher(store, resources, scheduler, helper)
  return { store, dispatcher, resources, scheduler, watcher, time: (instant: number) => { now = instant }, helper }
}
describe('scheduled native execution', () => {
  it('executes three queued pods through two slots and commits every input', async () => {
    const f = await setup(); const pods: string[] = []
    for (let i = 0; i < 3; i++) {
      const pod = f.store.createPod({ name: `Pod ${i}`, assignment: 'Synthetic scheduled script' }); pods.push(pod.id)
      f.scheduler.lifecycle(pod.id, 1, 'active'); await f.dispatcher.install(pod.id, 'deterministic')
      f.scheduler.save(pod.id, 0, { kind: 'interval', seconds: 60 }, true)
    }
    f.time(601000); f.scheduler.tick()
    expect(f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(2)
    await expect.poll(() => f.store.db.prepare('SELECT count(*) AS count FROM runs WHERE state=\'completed\'').get()!.count).toBe(2)
    f.scheduler.tick()
    await expect.poll(() => f.store.db.prepare('SELECT count(*) AS count FROM runs WHERE state=\'completed\'').get()!.count).toBe(3)
    for (const pod of pods) expect(f.scheduler.view(pod)).toMatchObject({ pending: 0, blocked: 0, nextAt: 661000 })
    expect(f.store.db.prepare('SELECT count(*) AS count FROM accepted_events WHERE state=\'processed\'').get()!.count).toBe(3)
  })
  it('detects changes across restart, including returning to earlier bytes, with atomic fingerprints', async () => {
    const f = await setup(); const pod = f.store.createPod({ name: 'References', assignment: 'Read a synthetic reference' })
    f.scheduler.lifecycle(pod.id, 1, 'active')
    const source = join(root, 'reference.txt'); await writeFile(source, 'A'); f.resources.assignReference(pod.id, 'Reference', source)
    await f.watcher.scan(); await f.watcher.scan()
    expect(f.scheduler.view(pod.id).pending).toBe(1)
    await f.dispatcher.stop(); dispatcher = undefined; f.store.close()
    store = new PodDatabase(root)
    const resources = new ResourceRegistry(store, () => {})
    const scheduler = new Scheduler(store, { start: () => { throw new Error('Intake-only fixture') } })
    const watcher = new ReferenceWatcher(store, resources, scheduler, f.helper)
    await writeFile(source, 'B'); await watcher.scan(); await writeFile(source, 'A'); await watcher.scan()
    expect(scheduler.view(pod.id).pending).toBe(3)
    await rm(source); await watcher.scan(); expect(scheduler.view(pod.id).error).toBeTruthy()
    await writeFile(source, 'A'); await watcher.scan(); expect(scheduler.view(pod.id).error).toBeNull()
    expect(scheduler.view(pod.id).pending).toBe(3)
  })
})
