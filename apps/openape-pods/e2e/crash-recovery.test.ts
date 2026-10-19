import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cleanupAfterEach, launch, retainsCompleteUnit, seed } from './fixtures/crash'
import { openPod } from './fixtures/navigation'
import { PodDatabase, digest } from '../src/worker/storage/database'
import { ResourceRegistry } from '../src/worker/resources/registry'
import { installExample } from '../src/worker/runs/examples'
import { podDirectories } from '../src/runtime/environment'

// Termination cases are split across two files so they run on separate workers.
cleanupAfterEach()
describe('checkpoint recovery in Electron', () => {
  it.each(['worker', 'app'] as const)('retains a complete unit through %s termination and retries without duplication', target => retainsCompleteUnit(target), 120000)
})

it('serves shared-data administration through the actual Electron preload, main and worker route', async () => {
  const { root } = await seed()
  const { page } = await launch(root, false)
  expect(await page.evaluate(() => window.pods.domain({ type: 'list' }))).toMatchObject({ namespaces: [], questions: [], held: [] })
  await expect(page.evaluate(() => window.pods.domain({ type: 'list', owner: 'forged' } as never))).rejects.toThrow('Unsupported data fields')
  expect((await page.evaluate(() => window.pods.getStatus())).worker.state).toBe('ready')
  await openPod(page, 'Checkpoint recovery')
  await page.getByRole('heading', { name: 'Checkpoint recovery' }).waitFor()
  await mkdir('.artifacts', { recursive: true })
  await page.screenshot({ path: '.artifacts/domain-route.png', fullPage: true })
})

it('settles claimed work of a killed worker through a real desktop restart and completes it exactly once', async () => {
  const { root } = await seed()
  const store = new PodDatabase(root)
  const resources = new ResourceRegistry(store, () => {})
  const runtime = JSON.parse(await readFile(resolve('dist/vendor/manifest.json'), 'utf8'))
  function scripted(name: string, body: string, work?: unknown): string {
    const pod = store.createPod({ name })
    installExample(store, resources, pod.id, 'deterministic', runtime.dependencyLockHash)
    const previous = JSON.parse(store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=?').get(pod.id)!.manifest as string)
    const code = `${work ? `export const work=${JSON.stringify(work)};` : ''} export async function run(context) { ${body} return {status:'completed',summary:'Synthetic shared work settled',completedInputIds:context.input.eventIds,gapIds:[]}; }`
    const hash = digest(code)
    store.storeScript(pod.id, { ...previous, contentHash: hash, ...(work ? { work } : {}) }, code)
    store.transaction(() => {
      store.db.prepare('UPDATE pods SET active_script=?,lifecycle=\'active\' WHERE id=?').run(hash, pod.id)
      store.db.prepare('INSERT INTO validations VALUES(?,?,?,?,?)').run(pod.id, hash, store.getPod(pod.id).bindingRevision, 0, '{"synthetic":true,"nativeRecovery":true}')
    })
    return pod.id
  }
  const work = [{ operation: 'restart/assessment', input: 'restart/records', output: 'restart/results', fields: [], filter: {}, ruleVersions: [1] }]
  const consumer = scripted('Restart consumer', `const fs=await import('node:fs/promises'); for (const item of await context.work.find({operation:'restart/assessment'})) { const claim = await context.work.claim({key:item.key}); await fs.writeFile(context.input.home+'/held','ready'); let released=false; for(let i=0;i<1000;i++){try{await fs.access(context.input.home+'/release');released=true;break;}catch(error){if(error.code!=='ENOENT')throw error;} await new Promise(resolve=>setTimeout(resolve,20));} if(!released)throw new Error('Synthetic hold was not released'); await context.work.complete({claimToken:claim.claimToken,result:{done:true}}) }`, work)
  const { DomainData } = await import('../src/worker/data/domain')
  const data = new DomainData(store)
  data.define({ path: 'restart/records', writer: 'owner', mode: 'records', readers: [consumer] })
  data.define({ path: 'restart/results', writer: consumer, mode: 'results', readers: [] })
  data.set('owner', 'restart/records/one', { subject: 'Synthetic restart input' }, 0)
  const home = (await podDirectories(root, consumer)).home
  store.close()
  const inspect = <T>(read: (database: PodDatabase) => T): T => {
    const database = new PodDatabase(root)
    try { return read(database) }
    finally { database.close() }
  }
  const { app, page } = await launch(root, false)
  await expect.poll(async () => {
    try { return (await page.evaluate(podId => window.pods.runs({ type: 'start', podId }), consumer)) ? 'started' : 'starting' }
    catch (failure) { if (!(failure instanceof Error) || !failure.message.includes('ready local runtime')) throw failure; return 'starting' }
  }).toBe('started')
  await expect.poll(async () => {
    try { await access(join(home, 'held')); return true }
    catch (failure) { if ((failure as NodeJS.ErrnoException).code !== 'ENOENT') throw failure; return false }
  }, { timeout: 30000 }).toBe(true)
  expect(inspect(database => database.db.prepare('SELECT state FROM work_items').get()!.state)).toBe('claimed')
  const worker = (await page.evaluate(() => window.pods.getStatus())).worker.pid!
  process.kill(worker, 'SIGKILL')
  await page.getByRole('alert').filter({ hasText: 'Quit and reopen Pods' }).waitFor()
  await app.close()
  await expect.poll(() => {
    try { process.kill(worker, 0); return 'alive' }
    catch (failure) { if ((failure as NodeJS.ErrnoException).code !== 'ESRCH') throw failure; return 'gone' }
  }).toBe('gone')
  await writeFile(join(home, 'release'), 'explicit synthetic release')
  const { app: reopenedApp, page: reopened } = await launch(root, false)
  // The interrupted claim is never resumed by the dead run; once its processes are proven stopped it waits for a retry.
  await expect.poll(() => inspect(database => database.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count), { timeout: 30000 }).toBe(0)
  await expect.poll(() => inspect(database => database.db.prepare('SELECT state FROM work_items').get()!.state), { timeout: 30000 }).not.toBe('claimed')
  expect(inspect(database => database.db.prepare('SELECT state FROM work_items').get()!.state)).toBe('retry_wait')
  // Simulates the elapsed retry backoff instead of waiting a minute.
  inspect(database => database.db.prepare('UPDATE work_items SET ready_at=? WHERE state=\'retry_wait\'').run(Date.now()))
  await expect.poll(async () => {
    try { await reopened.evaluate(podId => window.pods.runs({ type: 'start', podId }), consumer); return true }
    catch { return false }
  }, { timeout: 30000 }).toBe(true)
  await expect.poll(() => inspect(database => database.db.prepare('SELECT state FROM work_items').get()!.state), { timeout: 60000 }).toBe('completed')
  expect(inspect(database => database.db.prepare('SELECT revision FROM data_entries WHERE namespace=\'restart/results\'').get()!.revision)).toBe(1)
  await mkdir('.artifacts', { recursive: true })
  await reopened.screenshot({ path: '.artifacts/work-recovery-native.png', fullPage: true })
  await reopenedApp.close()
}, 180000)
