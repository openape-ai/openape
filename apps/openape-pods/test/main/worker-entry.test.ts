// @vitest-environment node
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { PodDatabase } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { installExample } from '../../src/worker/runs/examples'
import { Scheduler } from '../../src/worker/scheduling/scheduler'
import { RunDispatcher } from '../../src/worker/runs/dispatcher'
import type { AgentRuntime } from '../../src/worker/agent/executor'
import type { RunServices } from '../../src/worker/runs/dispatcher'
import type { ProgramAuthority } from '../../src/main/programs/grants'
import { MailBridge } from '../../src/worker/mail/bridge'

const captured = vi.hoisted(() => ({ services: undefined as RunServices | undefined }))
vi.mock('../../src/worker/runs/dispatcher', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/worker/runs/dispatcher')>()
  return { ...original, RunDispatcher: class extends original.RunDispatcher {
    constructor(...args: ConstructorParameters<typeof original.RunDispatcher>) {
      super(...args); captured.services = args[3]
    }
  } }
})

// Loads the unchanged worker process entry (src/worker/entry.ts) with Electron's
// parentPort replaced by an in-memory port and the scheduler interval driven by
// fake timers. Formerly the packaged `crash-recovery` suspend case: a suspend
// signal pauses intake, and resume catches missed slots up exactly once.
let root = ''; let listener: (event: { data: unknown }) => Promise<void> = async () => {}
const replies = vi.fn()
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
  Object.defineProperty(process, 'parentPort', { configurable: true, value: { postMessage: replies, on: (_event: string, callback: typeof listener) => { listener = callback } } })
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

it('routes assigned SSH observations through the real worker entry without requiring mail access', async () => {
  const store = new PodDatabase(root)
  const bridge = vi.spyOn(MailBridge.prototype, 'execute').mockResolvedValue({ version: 1, profile: 'linde-server-v1', facts: { observedAt: '2026-09-30T14:00:00Z' } })
  try {
    const pod = store.createPod({ name: 'SSH inventory' }); const registry = new ResourceRegistry(store, () => {})
    registry.assignSsh(pod.id, { target: { alias: 'fixture.example', jumps: [], profile: 'linde-server-v1' }, profileHash: 'a'.repeat(64), hosts: [], knownHosts: [] }, { identity: { podId: pod.id }, grantId: 'approved' } as ProgramAuthority, 0)
    const resource = registry.list(pod.id)[0]!
    const scope = { podId: pod.id, runId: pod.id, epoch: 1, assignmentRevision: 1, capabilities: [resource.configuration.capability as string], root, assertCurrent: () => {}, registerDomain: () => {} }
    const invoke = captured.services!.tool!
    await expect(invoke({ sshInventory: resource.id }, new AbortController().signal, scope)).resolves.toMatchObject({ version: 1, facts: { observedAt: '2026-09-30T14:00:00Z' } })
    expect(bridge).toHaveBeenCalledTimes(1)
    await expect(invoke({ sshInventory: resource.id, command: 'id' }, new AbortController().signal, scope)).rejects.toThrow()
    await expect(invoke({ sshInventory: resource.id }, new AbortController().signal, { ...scope, capabilities: [] })).rejects.toThrow()
    registry.revoke(pod.id, resource.id, resource.revision)
    await expect(invoke({ sshInventory: resource.id }, new AbortController().signal, scope)).rejects.toThrow()
    expect(bridge).toHaveBeenCalledTimes(1)
  }
  finally { bridge.mockRestore(); store.close() }
})

it('validates the local network route and refuses creation on a central-connected runtime before mutation', async () => {
  await send({ id: 'networks-list', command: { networks: { type: 'list' } } })
  expect(replies).toHaveBeenCalledWith({ id: 'networks-list', state: { networks: [] } })
  await send({ id: 'networks-invalid', command: { networks: { type: 'list', owner: 'forged' } } })
  expect(replies).toHaveBeenCalledWith(expect.objectContaining({ id: 'networks-invalid', error: expect.any(String) }))
  vi.stubEnv('PODS_CENTRAL_ENABLED', '1')
  try {
    await send({ id: 'networks-create', command: { networks: { type: 'create', draft: { name: 'Synthetic network', groupId: randomUUID(), channels: [], members: [{ podId: randomUUID(), source: { schedule: null }, serialCase: false }] } } } })
    expect(replies).toHaveBeenCalledWith({ id: 'networks-create', error: 'Network creation requires bounded central publication support' })
    const store = new PodDatabase(root)
    try { expect(store.db.prepare('SELECT count(*) AS count FROM networks').get()!.count).toBe(0) }
    finally { store.close() }
  }
  finally { vi.stubEnv('PODS_CENTRAL_ENABLED', '') }
})
