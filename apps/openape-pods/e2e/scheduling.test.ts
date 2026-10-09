import { mkdtemp, realpath, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { GraphContract } from '../src/contracts/graphs'
import { PodGroups } from '../src/worker/workspace/groups'
import { podDirectories } from '../src/runtime/environment'
import { NetworkEngine } from '../src/worker/scheduling/network-engine'
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

it('runs persistent source and independent consumers through the native sandbox without legacy checkpoint writes', async () => {
  const f = await setup()
  const owner = { issuer: 'https://identity.example.invalid', subject: 'synthetic-native-network-owner' }
  f.store.db.prepare('INSERT INTO network_owners VALUES(?,?)').run(owner.issuer, owner.subject)
  f.store.db.prepare('UPDATE settings SET concurrency=3 WHERE id=1').run()
  const groups = new PodGroups(f.store)
  groups.execute({ type: 'organize', action: 'create', name: 'Native network fixture', revision: groups.view().revision })
  const groupId = groups.view().groups.at(-1)!.id
  const engine = new NetworkEngine(f.store, f.dispatcher, f.resources, f.helper, () => owner)
  async function member(name: string, contract: GraphContract, body: string): Promise<string> {
    const pod = f.store.createPod({ name })
    groups.execute({ type: 'organize', action: 'move', podId: pod.id, groupId, revision: groups.view().revision })
    await f.dispatcher.install(pod.id, 'deterministic')
    const previous = f.store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(pod.id, f.store.getPod(pod.id).activeScript!)!
    const manifest = JSON.parse(previous.manifest as string)
    const code = `export const contract=${JSON.stringify(contract)};\nexport async function run(context) { ${body} return {status:'completed',summary:'Synthetic native network completed',completedInputIds:context.input.eventIds,gapIds:[]}; }\n`
    const hash = digest(code); const definitionId = randomUUID()
    f.store.storeScript(pod.id, { ...manifest, contentHash: hash, contract }, code)
    f.store.transaction(() => {
      f.store.db.prepare('UPDATE pods SET active_script=?,lifecycle=\'active\' WHERE id=?').run(hash, pod.id)
      f.store.db.prepare('INSERT OR REPLACE INTO validations VALUES(?,?,?,?,?)').run(pod.id, hash, f.store.getPod(pod.id).bindingRevision, f.resources.epoch(pod.id), JSON.stringify({ synthetic: true, nativeAcceptance: true }))
      f.store.db.prepare('INSERT INTO pod_definitions VALUES(?,?,?,?,?)').run(definitionId, owner.issuer, owner.subject, name, Date.now())
      f.store.db.prepare('INSERT INTO pod_definition_versions VALUES(?,1,?,?,?,?)').run(definitionId, hash, manifest.dependencyLockHash, JSON.stringify(contract), Date.now())
      f.store.db.prepare('INSERT INTO instance_definition_bindings VALUES(?,?,1,1)').run(pod.id, definitionId)
    })
    return pod.id
  }
  const checkpoint = 'await context.progress.commit({expectedRevision:context.input.checkpointRevision,checkpoint:{count:Number(context.input.checkpoint.count??0)+1},sources:[],claims:[]});'
  const source = await member('Source', { takes: [], gives: ['test.a', 'test.b'], summary: 'Emits metadata' }, `for(const channel of ['test.a','test.b']) await context.network.emit({channel,key:'record-1',sourceItemId:'record-1',sourceVersion:'v1',payload:{subject:'Synthetic native item'}});${checkpoint}`)
  const a = await member('Consumer A', { takes: ['test.a'], gives: [], summary: 'Consumes A' }, checkpoint)
  const b = await member('Consumer B', { takes: ['test.b'], gives: [], summary: 'Consumes B' }, `const fs=await import('node:fs/promises'); await fs.writeFile(context.input.home+'/held','ready'); let released=false; for(let i=0;i<500;i++){try{await fs.access(context.input.home+'/release');released=true;break;}catch(error){if(error.code!=='ENOENT')throw error;} await new Promise(resolve=>setTimeout(resolve,20));} if(!released)throw new Error('Synthetic hold was not released');${checkpoint}`)
  const id = engine.execute({ type: 'create', draft: { name: 'Native persistent network', groupId, members: [{ podId: source, source: { schedule: null }, serialCase: false }, ...[a, b].map(podId => ({ podId, source: null, serialCase: true }))], channels: ['test.a', 'test.b'].map(name => ({ name, title: name, schemaVersion: 1, schema: { type: 'object', properties: { subject: { type: 'string' } }, required: ['subject'], additionalProperties: false } })) } }).createdId!
  engine.execute({ type: 'activate', id, revision: 1 })
  engine.tick()
  expect(f.store.db.prepare('SELECT count(*) AS count FROM network_invocations').get()!.count).toBe(0)
  function sourceNow(): void {
    const preview = engine.execute({ type: 'preview', id, revision: 1, podIds: [source], pausedPodIds: [], budget: 1 }).preview!
    engine.execute({ type: 'process', id, revision: 1, previewId: preview.id })
  }
  sourceNow()
  await expect.poll(() => f.store.db.prepare('SELECT state FROM network_invocations WHERE pod_id=?').get(source)?.state).toBe('completed')
  engine.tick()
  const home = (await podDirectories(f.store.root, b)).home
  try {
    await expect.poll(async () => {
      try { await access(join(home, 'held')); return true }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return false }
    }).toBe(true)
    await expect.poll(() => f.store.db.prepare('SELECT state FROM network_invocations WHERE pod_id=?').get(a)?.state).toBe('completed')
    expect(f.store.db.prepare('SELECT state FROM network_invocations WHERE pod_id=?').get(b)!.state).toBe('running')
    engine.execute({ type: 'pause', id, revision: 1 })
  }
  finally { await writeFile(join(home, 'release'), 'approved synthetic release') }
  await expect.poll(() => f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0)
  sourceNow()
  await expect.poll(() => f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0)
  engine.tick()
  expect(f.store.db.prepare('SELECT count(*) AS count FROM network_events').get()!.count).toBe(2)
  expect(f.store.db.prepare('SELECT count(*) AS count FROM network_deliveries WHERE state=\'done\'').get()!.count).toBe(2)
  expect(f.store.db.prepare('SELECT count(*) AS count FROM network_invocations WHERE pod_id=?').get(a)!.count).toBe(1)
  for (const podId of [source, a, b]) expect(f.store.checkpoint(podId)).toMatchObject({ revision: 0, body: {} })
  expect(engine.view().networks[0]!.state).toBe('paused')
  await engine.stop()
})
