import { machineRuntime } from './fixtures/machine'
import { mkdir, mkdtemp, realpath, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { PodDatabase } from '../src/worker/storage/database'
import { ResourceRegistry } from '../src/worker/resources/registry'
import { RunDispatcher } from '../src/worker/runs/dispatcher'
import { bundledModel } from './fixtures/responses'
import { launchSandbox } from './fixtures/sandbox'
import { RunStore } from '../src/worker/runs/store'
import { installExample } from '../src/worker/runs/examples'
import { Recovery } from '../src/worker/recovery/reconcile'
import { Scheduler } from '../src/worker/scheduling/scheduler'

let store: PodDatabase | undefined
let dispatcher: RunDispatcher | undefined
let root = ''
afterEach(async () => { await dispatcher?.stop(); store?.close(); dispatcher = undefined; store = undefined; if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); root = '' })
describe('owned runtime recovery', () => {
  it('reconciles a stopped owner root only after the native guardian confirms its domain closed', async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'pods-root-recovery-')))
    store = new PodDatabase(root)
    const resources = new ResourceRegistry(store, () => {})
    const pod = store.createPod({ name: 'Owner recovery fixture' })
    installExample(store, resources, pod.id, 'deterministic', 'a'.repeat(64))
    const runs = new RunStore(store)
    const run = runs.reserve(pod.id, store.getPod(pod.id).activeScript!, 0).run
    const key = `owner-script:${run.id}`
    const authority = { source: 'owner-activation', activationId: `${pod.id}:${run.scriptHash}:1:0`, podId: pod.id, scriptHash: run.scriptHash, assignmentRevision: 1, resourceEpoch: 0 }
    runs.append(run.id, 'recovery-boundary', { id: key, kind: 'untracked', operation: 'owner-script', authority })
    runs.append(run.id, 'root-script', { state: 'authorized', authority })
    const directory = join(root, 'runs', run.id)
    await mkdir(directory, { recursive: true })
    const script = join(directory, 'wait.mjs')
    await writeFile(script, 'setInterval(() => {}, 1000)')
    const helper = resolve('dist/native/pods-helper')
    const domain = await launchSandbox(helper, directory, { executable: process.execPath, workspace: directory, readFiles: [script], runtimeDirectories: [] }, [script], {}, (path, ownerPid) => runs.registerDomain(run.id, path, ownerPid))
    const starts: string[] = []
    const recovery = new Recovery(store, resources, new Scheduler(store, { start: (id) => { starts.push(id); return 'unused' } }), helper)
    try {
      await domain.processId
      runs.finish(run.id, 'cancelled', 'Synthetic cancelled root', 'Synthetic interruption')
      await expect(recovery.resolveHttp(pod.id, run.id, key, false, 'A stopped run row is not sufficient while the native child remains live')).rejects.toThrow(/still present|unverified/)
      expect(runs.events(pod.id, run.id).some(event => event.type === 'recovery-boundary-result')).toBe(false)
    }
    finally { domain.cancel(); await domain.completed }
    await recovery.resolveHttp(pod.id, run.id, key, false, 'The native guardian confirms closure; the synthetic script had no write operations')
    expect(runs.get(run.id)).toMatchObject({ state: 'cancelled', error: 'Synthetic interruption', recovery: null })
    const event = runs.events(pod.id, run.id).find(item => item.type === 'recovery-boundary-result')
    expect(event?.data).toMatchObject({ id: key, operation: 'owner-script', state: 'reconciled', applied: false })
    expect(JSON.stringify(event?.data)).not.toContain('exitCode')
    expect(starts).toEqual([])
    expect(store.db.prepare('SELECT * FROM effect_ledger').all()).toEqual([])
    await recovery.inspect(pod.id, run.id)
    expect(runs.get(run.id).recovery?.state).toBe('ready')
    expect(starts).toEqual([])
  })

  it('retains the lease until a cancelled SDK supervisor has actually stopped', async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'pods-recovery-')))
    store = new PodDatabase(root)
    const resources = new ResourceRegistry(store, id => dispatcher?.cancelPod(id))
    let markRequested: () => void = () => {}
    const requested = new Promise<void>((resolveRequest) => { markRequested = resolveRequest })
    dispatcher = new RunDispatcher(store, resources, { ...await machineRuntime(), helper: resolve('dist/native/pods-helper'), executable: process.execPath, entry: resolve('dist/runtime/script-entry.mjs'), runtimeDirectories: [], environment: {}, binary: resolve('dist/vendor/codex'), catalog: resolve('dist/vendor/models.json'), manifest: resolve('dist/vendor/manifest.json'), sdkHost: resolve('dist/runtime/sdk-host.mjs') }, {
      model: bundledModel,
      provider: async (_body, signal) => { markRequested(); return new Promise<Response>((_resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }) }) },
      tool: async () => { throw new Error('No tools assigned') },
    })
    const pod = store.createPod({ name: 'Recovery fixture' }); await dispatcher.install(pod.id, 'agent')
    const id = dispatcher.start(pod.id); await requested
    const row = store.db.prepare('SELECT path FROM execution_domains WHERE run_id=? AND path LIKE \'%/agent-%\'').get(id)!
    const record = (await readFile(row.path as string, 'utf8')).trim().split(' ')
    const guardian = Number(record[1]); process.kill(guardian, 'SIGSTOP')
    try {
      dispatcher.cancel(pod.id, id); await delay(500)
      expect(dispatcher.runs.get(id).state).toBe('running')
      expect(store.db.prepare('SELECT run_id FROM run_leases WHERE pod_id=?').get(pod.id)!.run_id).toBe(id)
    }
    finally { process.kill(guardian, 'SIGCONT') }
    await expect.poll(() => dispatcher!.runs.get(id).state).toBe('cancelled')
    expect(store.db.prepare('SELECT 1 FROM run_leases WHERE pod_id=?').get(pod.id)).toBeUndefined()
  })
})
