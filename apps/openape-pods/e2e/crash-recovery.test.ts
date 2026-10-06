import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { cleanupAfterEach, launch, retainsCompleteUnit, seed } from './fixtures/crash'
import { PodDatabase, digest } from '../src/worker/storage/database'
import { ResourceRegistry } from '../src/worker/resources/registry'
import { installExample } from '../src/worker/runs/examples'
import { RunDispatcher } from '../src/worker/runs/dispatcher'
import type { AgentRuntime } from '../src/worker/agent/executor'
import { NetworkEngine } from '../src/worker/scheduling/network-engine'
import { PodGroups } from '../src/worker/workspace/groups'
import { podDirectories } from '../src/runtime/environment'
import type { GraphContract } from '../src/contracts/graphs'

// Termination cases are split across two files so they run on separate workers.
cleanupAfterEach()
describe('checkpoint recovery in Electron', () => {
  it.each(['worker', 'app'] as const)('retains a complete unit through %s termination and retries without duplication', target => retainsCompleteUnit(target))
})

it('validates the network command through the actual Electron preload, main and worker route', async () => {
  const { root } = await seed()
  const { page } = await launch(root, false)
  expect(await page.evaluate(() => window.pods.networks({ type: 'list' }))).toEqual({ networks: [] })
  await expect(page.evaluate(() => window.pods.networks({ type: 'list', owner: 'forged' } as never))).rejects.toThrow('Invalid network definition fields')
  expect((await page.evaluate(() => window.pods.getStatus())).worker.state).toBe('ready')
  await page.getByText('Checkpoint recovery', { exact: true }).first().waitFor()
  await mkdir('.artifacts', { recursive: true })
  await page.screenshot({ path: '.artifacts/network-route.png', fullPage: true })
})

it('recovers an interrupted network through a real desktop restart and explicit owner retry', async () => {
  const { root } = await seed()
  const store = new PodDatabase(root)
  const owner = { issuer: 'https://identity.example.invalid', subject: 'synthetic-desktop-network-owner' }
  const resources = new ResourceRegistry(store, () => {})
  const runtime = JSON.parse(await readFile(resolve('dist/vendor/manifest.json'), 'utf8'))
  const helper = resolve('dist/native/pods-helper')
  const dispatcher = new RunDispatcher(store, resources, { helper, environment: {} } as AgentRuntime)
  const groups = new PodGroups(store)
  groups.execute({ type: 'organize', action: 'create', name: 'Synthetic network recovery', revision: groups.view().revision })
  const groupId = groups.view().groups.at(-1)!.id
  store.db.prepare('INSERT INTO network_owners VALUES(?,?)').run(owner.issuer, owner.subject)
  store.db.prepare('INSERT INTO remote_registration VALUES(1,?,0)').run(JSON.stringify({ owner }))
  function member(name: string, contract: GraphContract, body: string): string {
    const pod = store.createPod({ name })
    groups.execute({ type: 'organize', action: 'move', podId: pod.id, groupId, revision: groups.view().revision })
    installExample(store, resources, pod.id, 'deterministic', runtime.dependencyLockHash)
    const previous = JSON.parse(store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=?').get(pod.id)!.manifest as string)
    const code = `export const contract=${JSON.stringify(contract)}; export async function run(context) { ${body} return {status:'completed',summary:'Synthetic native network settled',completedInputIds:context.input.eventIds,gapIds:[]}; }`
    const hash = digest(code); const definitionId = randomUUID()
    store.storeScript(pod.id, { ...previous, contentHash: hash, contract }, code)
    store.transaction(() => {
      store.db.prepare('UPDATE pods SET active_script=?,lifecycle=\'active\' WHERE id=?').run(hash, pod.id)
      store.db.prepare('INSERT INTO validations VALUES(?,?,?,?,?)').run(pod.id, hash, store.getPod(pod.id).bindingRevision, 0, '{"synthetic":true,"nativeRecovery":true}')
      store.db.prepare('INSERT INTO pod_definitions VALUES(?,?,?,?,?)').run(definitionId, owner.issuer, owner.subject, name, Date.now())
      store.db.prepare('INSERT INTO pod_definition_versions VALUES(?,1,?,?,?,?)').run(definitionId, hash, runtime.dependencyLockHash, JSON.stringify(contract), Date.now())
      store.db.prepare('INSERT INTO instance_definition_bindings VALUES(?,?,1,1)').run(pod.id, definitionId)
    })
    return pod.id
  }
  const checkpoint = 'await context.progress.commit({expectedRevision:context.input.checkpointRevision,checkpoint:{processed:true},sources:[],claims:[]});'
  const source = member('Network recovery source', { takes: [], gives: ['test.input'], summary: 'Synthetic source' }, `await context.network.emit({channel:'test.input',key:'record',sourceItemId:'record',sourceVersion:'v1',payload:{subject:'Synthetic restart input'}});${checkpoint}`)
  const consumer = member('Network recovery consumer', { takes: ['test.input'], gives: [], summary: 'Synthetic consumer' }, `${checkpoint} const fs=await import('node:fs/promises'); await fs.writeFile(context.input.home+'/held','ready'); let released=false; for(let i=0;i<1000;i++){try{await fs.access(context.input.home+'/release');released=true;break;}catch(error){if(error.code!=='ENOENT')throw error;} await new Promise(resolve=>setTimeout(resolve,20));} if(!released)throw new Error('Synthetic hold was not released');`)
  const engine = new NetworkEngine(store, dispatcher, resources, helper, () => owner)
  const id = engine.execute({ type: 'create', draft: { name: 'Synthetic desktop restart', groupId, members: [{ podId: source, source: { schedule: null }, serialCase: false }, { podId: consumer, source: null, serialCase: true }], channels: [{ name: 'test.input', title: 'Input', schemaVersion: 1, schema: { type: 'object', properties: { subject: { type: 'string' } }, required: ['subject'], additionalProperties: false } }] } }).createdId!
  const home = (await podDirectories(root, consumer)).home
  await engine.stop(); await dispatcher.stop(); store.close()
  const inspect = <T>(read: (database: PodDatabase) => T): T => {
    const database = new PodDatabase(root)
    try { return read(database) }
    finally { database.close() }
  }
  const { app, page } = await launch(root, false)
  await expect.poll(async () => {
    try { return (await page.evaluate(id => window.pods.networks({ type: 'activate', id, revision: 1 }), id)).networks[0]!.state }
    catch (failure) { if (!(failure instanceof Error) || !failure.message.includes('ready local runtime')) throw failure; return 'starting' }
  }).toBe('active')
  const preview = await page.evaluate(({ id, source }) => window.pods.networks({ type: 'preview', id, revision: 1, podIds: [source], pausedPodIds: [], budget: 1 }), { id, source })
  await page.evaluate(({ id, previewId }) => window.pods.networks({ type: 'process', id, revision: 1, previewId }), { id, previewId: preview.preview!.id })
  await expect.poll(async () => {
    try { await access(join(home, 'held')); return true }
    catch (failure) { if ((failure as NodeJS.ErrnoException).code !== 'ENOENT') throw failure; return false }
  }).toBe(true)
  const invocation = inspect(database => database.db.prepare('SELECT run_id,generation,staged_checkpoint FROM network_invocations WHERE pod_id=?').get(consumer)!)
  expect(invocation.staged_checkpoint).toContain('processed')
  expect(inspect(database => database.db.prepare('SELECT revision FROM network_checkpoints WHERE pod_id=?').get(consumer)!.revision)).toBe(0)
  const worker = (await page.evaluate(() => window.pods.getStatus())).worker.pid!
  process.kill(worker, 'SIGKILL')
  await page.getByRole('alert').filter({ hasText: 'Quit and reopen Pods' }).waitFor()
  await app.close()
  await expect.poll(() => {
    try { process.kill(worker, 0); return 'alive' }
    catch (failure) { if ((failure as NodeJS.ErrnoException).code !== 'ESRCH') throw failure; return 'gone' }
  }).toBe('gone')
  const { app: reopenedApp, page: reopened } = await launch(root, false)
  await expect.poll(() => inspect(database => database.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count)).toBe(0)
  const stopped = inspect(database => database.db.prepare('SELECT generation,state,staged_checkpoint FROM network_invocations WHERE run_id=?').get(invocation.run_id!)!)
  expect(stopped.state).toBe('blocked')
  expect(stopped.staged_checkpoint).toContain('processed')
  expect(inspect(database => database.db.prepare('SELECT state FROM network_deliveries').get()!.state)).toBe('blocked')
  await writeFile(join(home, 'release'), 'explicit synthetic retry release')
  await reopened.evaluate(({ id, runId, generation }) => window.pods.networks({ type: 'retry', id, revision: 1, runId, generation }), { id, runId: invocation.run_id as string, generation: Number(stopped.generation) })
  await expect.poll(() => inspect(database => database.db.prepare('SELECT state FROM network_deliveries').get()!.state)).toBe('done')
  expect(inspect(database => database.db.prepare('SELECT revision FROM network_checkpoints WHERE pod_id=?').get(consumer)!.revision)).toBe(1)
  expect(inspect(database => database.db.prepare('SELECT count(*) AS count FROM network_event_identities').get()!.count)).toBe(1)
  expect(inspect(database => database.db.prepare('SELECT count(*) AS count FROM network_invocations WHERE pod_id=?').get(consumer)!.count)).toBe(2)
  await mkdir('.artifacts', { recursive: true })
  await reopened.screenshot({ path: '.artifacts/network-recovery-native.png', fullPage: true })
  await reopenedApp.close()
  expect(inspect(database => database.db.prepare('SELECT state FROM network_deliveries').get()!.state)).toBe('done')
})
