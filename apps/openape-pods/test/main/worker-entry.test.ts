// @vitest-environment node
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { PodDatabase } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { installExample } from '../../src/worker/runs/examples'
import { Scheduler } from '../../src/worker/scheduling/scheduler'
import { RunDispatcher } from '../../src/worker/runs/dispatcher'
import type { AgentRuntime } from '../../src/worker/agent/executor'

// Loads the unchanged worker process entry (src/worker/entry.ts) with Electron's
// parentPort replaced by an in-memory port and the scheduler interval driven by
// fake timers. Formerly the packaged `crash-recovery` suspend case: a suspend
// signal pauses intake, and resume catches missed slots up exactly once.
let root = ''; let listener: (event: { data: unknown }) => Promise<void> = async () => {}
const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
function runs(podId: string): number {
  const store = new PodDatabase(root)
  try { return store.db.prepare('SELECT count(*) AS count FROM runs WHERE pod_id=?').get(podId)!.count as number }
  finally { store.close() }
}
const send = (data: unknown) => listener({ data })
// One scheduler interval plus real time for its asynchronous storage check and
// scan to finish; the worker skips intervals while a previous tick still runs.
async function tick() { await vi.advanceTimersByTimeAsync(1100); await new Promise(resolve => setTimeout(resolve, 300)) }

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'pods-worker-entry-')))
  const store = new PodDatabase(root)
  const pod = store.createPod({ name: 'Scheduled example' })
  const registry = new ResourceRegistry(store, () => {})
  installExample(store, registry, pod.id, 'deterministic', 'a'.repeat(64))
  const scheduler = new Scheduler(store, new RunDispatcher(store, registry, {} as AgentRuntime))
  scheduler.save(pod.id, 0, { kind: 'interval', seconds: 60 }, true)
  store.db.prepare('UPDATE pods SET lifecycle=\'active\' WHERE id=?').run(pod.id)
  store.close()
  process.env.PODS_TEST_POD_ID = pod.id
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  vi.spyOn(process, 'cwd').mockReturnValue(root)
  Object.defineProperty(process, 'parentPort', { configurable: true, value: { postMessage: () => {}, on: (_event: string, callback: typeof listener) => { listener = callback } } })
  vi.stubEnv('PODS_RUNTIME_EXECUTABLE', process.execPath)
  await import('../../src/worker/entry')
  vi.mocked(process.cwd).mockRestore()
  await send({ id: 'provider', command: { provider: null } })
})
// Each test file runs in its own process; the loaded worker is discarded with it
// instead of being stopped (its stop path waits on timers that are faked here).
afterAll(async () => {
  vi.useRealTimers(); vi.unstubAllEnvs()
  Reflect.deleteProperty(process, 'parentPort')
  await rm(root, { recursive: true, force: true })
})

it('pauses scheduled intake while suspended and catches missed slots up once on resume', async () => {
  const podId = process.env.PODS_TEST_POD_ID!
  await send('suspend')
  const store = new PodDatabase(root)
  try { store.db.prepare('UPDATE schedules SET next_at=? WHERE pod_id=?').run(Date.now() - 600000, podId) }
  finally { store.close() }
  await tick(); await tick()
  expect(runs(podId)).toBe(0)
  await send('resume')
  await tick()
  await vi.waitFor(() => expect(runs(podId)).toBe(1))
  await tick(); await tick()
  expect(runs(podId)).toBe(1)
  expect(exit).not.toHaveBeenCalledWith(1)
})
