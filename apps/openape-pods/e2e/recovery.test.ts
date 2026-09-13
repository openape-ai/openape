import { mkdtemp, realpath, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { PodDatabase } from '../src/worker/storage/database'
import { ResourceRegistry } from '../src/worker/resources/registry'
import { RunDispatcher } from '../src/worker/runs/dispatcher'

let store: PodDatabase | undefined
let dispatcher: RunDispatcher | undefined
let root = ''
afterEach(async () => { await dispatcher?.stop(); store?.close(); if (root) await rm(root, { recursive: true, force: true }) })
describe('owned runtime recovery', () => {
  it('retains the lease until a cancelled SDK supervisor has actually stopped', async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'pods-recovery-')))
    store = new PodDatabase(root)
    const resources = new ResourceRegistry(store, id => dispatcher?.cancelPod(id))
    let markRequested: () => void = () => {}
    const requested = new Promise<void>((resolveRequest) => { markRequested = resolveRequest })
    dispatcher = new RunDispatcher(store, resources, { helper: resolve('dist/native/pods-helper'), executable: process.execPath, entry: resolve('dist/runtime/script-entry.mjs'), runtimeDirectories: [], environment: {}, binary: resolve('dist/vendor/codex'), catalog: resolve('dist/vendor/models.json'), manifest: resolve('dist/vendor/manifest.json'), sdkHost: resolve('dist/runtime/sdk-host.mjs') }, {
      provider: async (_body, signal) => { markRequested(); return new Promise<Response>((_resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }) }) },
      tool: async () => { throw new Error('No tools assigned') },
    })
    const pod = store.createPod({ name: 'Recovery fixture', assignment: 'Synthetic provider only' }); await dispatcher.install(pod.id, 'agent')
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
