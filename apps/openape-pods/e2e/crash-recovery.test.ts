import { _electron as electron } from 'playwright'
import type { ElectronApplication } from 'playwright'
import { mkdtemp, realpath, rm, readFile, mkdir } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import { PodDatabase, digest } from '../src/worker/storage/database'
import { ResourceRegistry } from '../src/worker/resources/registry'
import { installExample } from '../src/worker/runs/examples'
import { fixtureDirectory } from '../src/main/fixture'

const require = createRequire(import.meta.url)
const applications: { app: ElectronApplication, child: ChildProcess }[] = []; const roots: string[] = []
afterEach(async () => {
  for (const { app, child } of applications.splice(0)) { if (child.exitCode === null && child.signalCode === null) await app.close() }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function launch(root: string, packaged: boolean) {
  const app = await electron.launch({ executablePath: packaged ? resolve('release/mac-arm64/OpenApe Pods Fixture.app/Contents/MacOS/OpenApe Pods Fixture') : require('electron'), args: packaged ? [] : ['.'], cwd: resolve('.'), env: { HOME: root, TMPDIR: tmpdir(), PATH: '/usr/bin:/bin', OPENAPE_PODS_FIXTURE_DIR: root, NODE_ENV: 'test' } })
  applications.push({ app, child: app.process() })
  const page = await app.firstWindow()
  await page.waitForFunction(async () => (await window.pods.getStatus()).worker.state === 'ready')
  return { app, page }
}
async function seed() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-crash-'))); roots.push(root); fixtureDirectory(root)
  const store = new PodDatabase(root)
  try {
    const pod = store.createPod({ name: 'Checkpoint recovery', assignment: 'Commit one synthetic fact, then wait for explicit recovery.' })
    const registry = new ResourceRegistry(store, () => {})
    const runtime = JSON.parse(await readFile(resolve('dist/vendor/manifest.json'), 'utf8'))
    installExample(store, registry, pod.id, 'deterministic', runtime.dependencyLockHash)
    const original = JSON.parse(store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=?').get(pod.id)!.manifest as string)
    const artifact = `export async function run(context) {
      if (!context.input.checkpoint.unitCommitted) {
        await context.progress.commit({expectedRevision:context.input.checkpointRevision,checkpoint:{unitCommitted:true},sources:[{id:'source-1',locator:'fixture:one',version:'1',content:'The fixture is committed.'}],claims:[{id:'claim-1',matter:'fixture',kind:'finding',text:'One committed unit',sourceIds:['source-1']}]});
        await new Promise(() => {});
      }
      return {status:'completed',summary:'Recovered committed unit',completedInputIds:context.input.eventIds,gapIds:[]};
    }`
    const manifest = store.storeScript(pod.id, { ...original, contentHash: digest(artifact) }, artifact)
    store.db.prepare('INSERT INTO validations VALUES(?,?,?,?,?)').run(pod.id, manifest.contentHash, pod.revision, 0, JSON.stringify({ kind: 'synthetic-crash-fixture' }))
    store.db.prepare('UPDATE pods SET active_script=? WHERE id=?').run(manifest.contentHash, pod.id)
    return { root, podId: pod.id }
  }
  finally { store.close() }
}
describe('checkpoint recovery in Electron', () => {
  it('pauses intake during a suspend signal and coalesces missed slots on resume', async () => {
    const { root, podId } = await seed(); const { app, page } = await launch(root, true)
    await page.evaluate(podId => window.pods.runs({ type: 'installExample', podId, variant: 'deterministic' }), podId)
    await page.evaluate(podId => window.pods.scheduling({ type: 'save', podId, revision: 0, spec: { kind: 'interval', seconds: 60 }, enabled: true }), podId)
    await page.evaluate(podId => window.pods.scheduling({ type: 'lifecycle', podId, revision: 1, lifecycle: 'active' }), podId)
    await app.evaluate(({ powerMonitor }) => powerMonitor.emit('suspend'))
    await delay(100)
    const store = new PodDatabase(root)
    try { store.db.prepare('UPDATE schedules SET next_at=? WHERE pod_id=?').run(Date.now() - 600000, podId) }
    finally { store.close() }
    await delay(1200)
    expect((await page.evaluate(podId => window.pods.runs({ type: 'list', podId }), podId)).runs).toHaveLength(0)
    await app.evaluate(({ powerMonitor }) => powerMonitor.emit('resume'))
    await expect.poll(async () => (await page.evaluate(podId => window.pods.runs({ type: 'list', podId }), podId)).runs[0]?.state, { timeout: 10000 }).toBe('completed')
    await delay(1200)
    expect((await page.evaluate(podId => window.pods.runs({ type: 'list', podId }), podId)).runs).toHaveLength(1)
    expect((await page.evaluate(() => window.pods.workspace({ type: 'pauseAll' }))).pods[0]!.lifecycle).toBe('paused')
  })
  it.each(['worker', 'app', 'quit', 'script'] as const)('retains a complete unit through %s termination and retries without duplication', async (target) => {
    const { root, podId } = await seed(); const packaged = target !== 'worker'
    const { app, page } = await launch(root, packaged)
    await page.evaluate(podId => window.pods.runs({ type: 'start', podId }), podId)
    const current = async () => (await page.evaluate(podId => window.pods.runs({ type: 'list', podId }), podId)).runs[0]!
    const id = (await current()).id
    await expect.poll(async () => (await page.evaluate(({ podId, runId }) => window.pods.runs({ type: 'list', podId, runId }), { podId, runId: id })).events.some(event => event.type === 'checkpoint')).toBe(true)
    const worker = (await page.evaluate(() => window.pods.getStatus())).worker.pid!
    if (target === 'script') {
      const store = new PodDatabase(root)
      const path = store.db.prepare('SELECT path FROM execution_domains WHERE run_id=?').get(id)!.path as string
      store.close()
      const record = (await readFile(path, 'utf8')).trim().split(' ')
      process.kill(Number(record[4]), 'SIGKILL')
      await expect.poll(async () => (await current()).state).toBe('failed')
      await app.close()
    }
    else if (target === 'worker') { process.kill(worker, 'SIGKILL'); await page.getByRole('alert').filter({ hasText: 'Quit and reopen Pods' }).waitFor(); await app.close() }
    else if (target === 'quit') {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
      expect((await current()).state).toBe('running')
      await app.close()
    }
    else { const child = app.process(); child.kill('SIGKILL'); await expect.poll(() => child.signalCode).toBe('SIGKILL') }
    await expect.poll(() => {
      try { process.kill(worker, 0); return 'alive' }
      catch { return 'gone' }
    }, { timeout: 10000 }).toBe('gone')
    const { page: reopened } = await launch(root, packaged)
    const stopped = (await reopened.evaluate(podId => window.pods.runs({ type: 'list', podId }), podId)).runs[0]!
    expect(stopped.state).toBe(target === 'quit' ? 'cancelled' : target === 'script' ? 'failed' : 'interrupted')
    await reopened.getByRole('tab', { name: 'Runs', exact: true }).click()
    await reopened.getByRole('button', { name: 'Check stopped execution' }).click()
    await reopened.getByText('Recovery: ready', { exact: true }).waitFor()
    await reopened.getByRole('button', { name: 'Retry remaining inputs' }).click()
    await reopened.getByRole('button', { name: 'Recovered committed unit', exact: true }).waitFor()
    const store = new PodDatabase(root)
    try {
      expect(store.checkpoint(podId)).toEqual({ revision: 1, body: { unitCommitted: true } })
      expect(store.db.prepare('SELECT count(*) AS count FROM claims').get()!.count).toBe(1)
      expect(store.db.prepare('SELECT count(*) AS count FROM accepted_events WHERE state!=\'processed\'').get()!.count).toBe(0)
      expect(store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0)
    }
    finally { store.close() }
    if (target === 'app') { await mkdir(resolve('.artifacts'), { recursive: true }); await reopened.screenshot({ path: resolve('.artifacts/recovery-packaged.png') }) }
  })
})
