import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { digest, PodDatabase  } from '../src/worker/storage/database'
import { ResourceRegistry } from '../src/worker/resources/registry'
import { RunDispatcher } from '../src/worker/runs/dispatcher'
import { Scheduler } from '../src/worker/scheduling/scheduler'
import { ReferenceWatcher } from '../src/worker/scheduling/references'

let store: PodDatabase | undefined
let dispatcher: RunDispatcher | undefined
let root = ''
afterEach(async () => { await dispatcher?.stop(); store?.close(); if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) })
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
      const pod = f.store.createPod({ name: `Pod ${i}` }); pods.push(pod.id)
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
    const f = await setup(); const pod = f.store.createPod({ name: 'References' })
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

it('lets two Pods share data through the native sandbox: the consumer finds its own work and never repeats an unchanged input', async () => {
  const f = await setup()
  async function scripted(name: string, code: string, work?: unknown): Promise<string> {
    const pod = f.store.createPod({ name })
    await f.dispatcher.install(pod.id, 'deterministic')
    const previous = f.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(pod.id, f.store.getPod(pod.id).activeScript!)!
    const manifest = JSON.parse(previous.manifest as string)
    const hash = digest(code)
    f.store.storeScript(pod.id, { ...manifest, contentHash: hash, ...(work ? { work } : {}) }, code)
    f.store.transaction(() => {
      f.store.db.prepare('UPDATE pods SET active_script=?,lifecycle=\'active\' WHERE id=?').run(hash, pod.id)
      f.store.db.prepare('INSERT OR REPLACE INTO validations VALUES(?,?,?,?,?)').run(pod.id, hash, f.store.getPod(pod.id).bindingRevision, f.resources.epoch(pod.id), JSON.stringify({ synthetic: true, nativeAcceptance: true }))
    })
    return pod.id
  }
  const done = 'return {status:\'completed\',summary:\'Synthetic shared data\',completedInputIds:context.input.eventIds,gapIds:[]}'
  const source = await scripted('Source', `export async function run(context) { const current = await context.data.get('native/records/one'); if (!current) await context.data.set('native/records/one', { subject: 'Synthetic native item' }, { expectedRevision: 0 }); ${done} }\n`)
  const work = [{ operation: 'native/assessment', input: 'native/records', output: 'native/results', fields: ['subject'], filter: {}, ruleVersions: [1] }]
  const consumer = await scripted('Consumer', `export const work = ${JSON.stringify(work)};\nexport async function run(context) { for (const item of await context.work.find({ operation: 'native/assessment' })) { const claim = await context.work.claim({ key: item.key }); await context.work.complete({ claimToken: claim.claimToken, result: { relevant: false, subject: claim.input.value.subject } }) } ${done} }\n`)
  const { DomainData } = await import('../src/worker/data/domain')
  const data = new DomainData(f.store)
  data.define({ path: 'native/records', writer: source, mode: 'records', readers: [consumer] })
  data.define({ path: 'native/results', writer: consumer, mode: 'results', readers: [] })
  const run = async (podId: string) => {
    const id = f.dispatcher.start(podId, { reason: 'manual', eventIds: [] })
    await expect.poll(() => f.store.db.prepare('SELECT state FROM runs WHERE id=?').get(id)!.state, { timeout: 30000 }).not.toBe('running')
    return f.dispatcher.runs.get(id)
  }
  expect(await run(source)).toMatchObject({ state: 'completed' })
  expect(await run(consumer)).toMatchObject({ state: 'completed' })
  expect(data.get('owner', 'native/results/one')).toMatchObject({ value: { relevant: false, subject: 'Synthetic native item' }, result: { operation: 'native/assessment' } })
  // A negative result is a result: the unchanged input is not offered again, and a scheduled run is skipped.
  expect(f.dispatcher.work.pending(consumer)).toBe(false)
  expect(await run(consumer)).toMatchObject({ state: 'completed' })
  expect(data.revision('native/results/one')).toBe(1)
}, 60000)
