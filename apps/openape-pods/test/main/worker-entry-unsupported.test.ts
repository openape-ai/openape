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

// The real worker entry on an unverified kernel: storage and owner commands answer, but no Pod is scheduled or started.
vi.mock('../../src/main/support', async (original) => {
  const actual = await original<typeof import('../../src/main/support')>()
  return { ...actual, executionSupport: () => actual.executionSupport('darwin', 'arm64', '99.0.0') }
})
const captured = vi.hoisted(() => ({ startControlled: undefined as ((podId: string, operationId: string) => string) | undefined }))
vi.mock('../../src/worker/master/control', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/worker/master/control')>()
  return { ...original, MasterControl: class extends original.MasterControl { constructor(...args: ConstructorParameters<typeof original.MasterControl>) { super(...args); captured.startControlled = args[5] } } }
})

let root = ''; let podId = ''; let listener: (event: { data: unknown }) => Promise<void> = async () => {}
const replies = vi.fn()
const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
const send = (data: unknown) => listener({ data })
function runs(): number {
  const store = new PodDatabase(root)
  try { return store.db.prepare('SELECT count(*) AS count FROM runs WHERE pod_id=?').get(podId)!.count as number }
  finally { store.close() }
}
async function tick() { await vi.advanceTimersByTimeAsync(1100); await new Promise(resolve => setTimeout(resolve, 300)) }

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'pods-worker-unsupported-')))
  const store = new PodDatabase(root)
  const pod = store.createPod({ name: 'Due example' }); podId = pod.id
  const registry = new ResourceRegistry(store, () => {})
  installExample(store, registry, pod.id, 'deterministic', 'a'.repeat(64))
  new Scheduler(store, new RunDispatcher(store, registry, {} as AgentRuntime)).save(pod.id, 0, { kind: 'interval', seconds: 60 }, true)
  store.db.prepare('UPDATE pods SET lifecycle=\'active\' WHERE id=?').run(pod.id)
  store.db.prepare('UPDATE schedules SET next_at=? WHERE pod_id=?').run(Date.now() - 600000, pod.id)
  store.close()
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  vi.spyOn(process, 'cwd').mockReturnValue(root)
  Object.defineProperty(process, 'parentPort', { configurable: true, value: { postMessage: replies, on: (_event: string, callback: typeof listener) => { listener = callback } } })
  vi.stubEnv('PODS_RUNTIME_EXECUTABLE', process.execPath)
  await (await import('../../src/worker/entry')).started
  vi.mocked(process.cwd).mockRestore()
  await send({ id: 'provider', command: { provider: null } })
  await send({ id: 'startup-inspection', command: { inspectCredentials: true } })
  expect(replies).toHaveBeenCalledWith({ id: 'startup-inspection', state: true })
})
afterAll(async () => {
  vi.useRealTimers(); vi.unstubAllEnvs()
  Reflect.deleteProperty(process, 'parentPort')
  await rm(root, { recursive: true, force: true })
})

it('answers storage commands but never schedules a due Pod or accepts a manual or controlled start', async () => {
  await send({ id: 'list', command: { type: 'list' } })
  expect(replies).toHaveBeenCalledWith({ id: 'list', state: expect.objectContaining({ pods: [expect.objectContaining({ id: podId })] }) })
  await tick(); await tick(); await tick()
  expect(runs()).toBe(0)
  await send({ id: 'manual', command: { run: { type: 'start', podId } } })
  expect(replies).toHaveBeenCalledWith({ id: 'manual', error: expect.stringContaining('Pod execution is blocked on darwin 99.0.0 (arm64)') })
  expect(() => captured.startControlled!(podId, 'operation')).toThrow('Pod execution is blocked on darwin 99.0.0')
  await tick(); await tick()
  expect(runs()).toBe(0)
  expect(exit).not.toHaveBeenCalledWith(1)
})
