// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { PodDatabase } from '../src/worker/storage/database'
import { ResourceRegistry } from '../src/worker/resources/registry'
import { RunDispatcher } from '../src/worker/runs/dispatcher'
import { Scheduler } from '../src/worker/scheduling/scheduler'
import { MasterControl } from '../src/worker/master/control'
import { ScriptWorkspace } from '../src/worker/workspace/scripts'
import { WorkspaceDetails } from '../src/worker/workspace/details'
import { CentralProjection } from '../src/worker/central/projection'
import { CentralController, centralState, offlineAlert, partBatches } from '../src/main/central/controller'
import type { CentralExecutor } from '../src/main/central/controller'
import { assembleSnapshot, splitSnapshot } from '../src/contracts/central-parts'
import { WorkspaceStore } from '../../openape-pods-relay/server/utils/workspace-store'
import type { WorkspaceActor } from '../../openape-pods-relay/server/utils/workspace-store'
import type { AgentRuntime } from '../src/worker/agent/executor'
import type { CentralSnapshot } from '../src/contracts/central'

vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() }, safeStorage: {}, app: { getPath: () => '/nonexistent' } }))

const cleanup: (() => Promise<void> | void)[] = []
afterEach(async () => { for (const task of cleanup.splice(0).reverse()) await task() })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pods-central-'))
  const store = new PodDatabase(root)
  cleanup.push(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
  const resources = new ResourceRegistry(store, () => {})
  const runtime = {} as AgentRuntime
  const runs = new RunDispatcher(store, resources, runtime)
  const scheduler = new Scheduler(store, runs)
  const master = new MasterControl(store, resources, runs, scheduler, runtime)
  const scripts = new ScriptWorkspace(store, resources, master)
  const projection = new CentralProjection(store, resources, scripts, runs, scheduler)
  const owner = { issuer: 'https://owner.example', subject: 'owner' }
  const actor = { id: randomUUID(), generation: randomUUID(), owner }
  const pod = store.createPod({ name: 'Test monitor' })
  store.db.prepare('INSERT INTO remote_pods VALUES(?,?,?,?,?,?,NULL)').run(pod.id, JSON.stringify(owner), actor.id, actor.generation, 'ready', '{}')
  return { store, root, projection, actor, pod, details: new WorkspaceDetails(store, resources) }
}
type Completion = Parameters<WorkspaceStore['publish']>[5]
function relay(server: WorkspaceStore, actor: WorkspaceActor) {
  return async (body: Record<string, unknown>): Promise<unknown> => {
    const lease = String(body.lease)
    if (body.type === 'inventory') return server.inventory(actor.owner)
    if (body.type === 'read') return body.view ? server.view(actor.owner, String(body.runtimeId), String(body.podId), body as never) : server.read(actor.owner, String(body.runtimeId), String(body.podId))
    if (body.type === 'operation') return server.visibleOperation(actor.owner, String(body.id))
    if (body.type === 'submit') return server.submit(actor.owner, String(body.runtimeId), Number(body.revision), body.command as Parameters<WorkspaceStore['submit']>[3], String(body.id))
    if (body.type === 'begin') return server.begin(actor)
    if (body.type === 'parts') return server.stage(actor, lease, body.parts as Record<string, unknown>)
    if (body.type === 'publish' && body.format === 2) return server.publishParts(actor, lease, String(body.id), Number(body.revision), body.changes as Record<string, string | null>, String(body.hash), body.completion as Completion)
    if (body.type === 'publish') return server.publish(actor, lease, String(body.id), Number(body.revision), body.snapshot, body.completion as Completion)
    if (body.type === 'heartbeat') return server.heartbeat(actor, lease, String(body.hash))
    if (body.type === 'claim') return server.claim(actor, lease)
    if (body.type === 'disconnect') return server.disconnect(actor, lease)
    throw new Error(`Unexpected request ${String(body.type)}`)
  }
}
it('adopts the current schema repeatedly without credentials or local process leases', () => {
  const { store, projection, actor, pod } = fixture()
  const first = projection.snapshot(actor.owner)
  expect(first.workspace.pods[0]?.id).toBe(pod.id)
  expect(first.archive.schema).toBe(23)
  expect(Object.keys(first.archive.tables)).not.toContain('connections')
  expect(Object.keys(first.archive.tables)).not.toContain('run_leases')
  expect(first).toEqual(projection.snapshot(actor.owner))
  store.db.prepare('UPDATE remote_pods SET owner=?').run(JSON.stringify({ ...actor.owner, subject: 'other' }))
  expect(() => projection.snapshot(actor.owner)).toThrow('Every Pod must belong')
})
it('executes the same MCP/browser command once and exposes central results with offline gates', async () => {
  const { root, store, projection, actor, pod, details } = fixture()
  const runId = randomUUID()
  store.db.prepare('INSERT INTO runs VALUES(?,?,?,\'failed\',1,2,?,?,0,0)').run(runId, pod.id, 'b'.repeat(64), 'Synthetic result', 'Synthetic failure')
  const server = new WorkspaceStore(':memory:'); cleanup.push(() => server.close())
  const execute = vi.fn(async () => details.execute({ type: 'describe', podId: pod.id, revision: 0, text: 'Shared with both clients' }))
  const request = relay(server, actor)
  const controller = new CentralController(root, request, { snapshot: async () => projection.snapshot(actor.owner), execute, gate: async () => {} }, '/unused-no-artifacts')
  cleanup.push(() => controller.stop()); controller.start()
  await vi.waitFor(() => expect(controller.available, controller.error ?? '').toBe(true))
  const { FixtureWorker } = await import('../src/main/worker')
  const worker = new FixtureWorker(() => {}); worker.central = controller
  const call = (query: Record<string, unknown>) => worker.codex({ id: randomUUID(), action: { action: 'workspace', query } })
  expect(await call({ type: 'inventory' })).toMatchObject([{ online: true, workspace: { pods: [{ id: pod.id, online: true }] } }])
  const id = randomUUID()
  const command = { channel: 'details' as const, body: { type: 'describe', podId: pod.id, revision: 0, text: 'Shared with both clients' } }
  const submit = { type: 'submit', runtimeId: actor.id, revision: 1, command, id }
  await call(submit)
  await call(submit)
  await vi.waitFor(() => expect(server.operation(actor.owner, id).state).toBe('applied'), { timeout: 5000 })
  expect(await call(submit)).toMatchObject({ id, state: 'applied' })
  expect(await call({ type: 'operation', id })).toMatchObject({ id, state: 'applied' })
  await expect(call({ ...submit, command: { ...command, body: { ...command.body, text: 'Changed retry' } } })).rejects.toThrow('workspace_operation_conflict')
  await expect(call({ ...submit, id: randomUUID() })).rejects.toThrow('workspace_revision_conflict')
  expect(await call({ type: 'read', runtimeId: actor.id, podId: pod.id })).toMatchObject({ pod: { details: { description: { text: 'Shared with both clients' } }, runs: { runs: [{ id: runId, summary: 'Synthetic result', error: 'Synthetic failure', state: 'failed' }] } } })
  expect(execute).toHaveBeenCalledOnce()
  expect(server.read(actor.owner, actor.id, pod.id).pod.details.description?.text).toBe('Shared with both clients')
  const archived = server.db.prepare('SELECT value FROM parts WHERE runtime_id=? AND key=\'table/pod_descriptions/0\'').get(actor.id)!.value as string
  expect(JSON.parse(archived) as CentralSnapshot['archive']['tables'][string]).toHaveLength(1)
  expect(controller.status()).toMatchObject({ state: 'online', format: 2, runtimeId: actor.id, error: null })
  await controller.stop()
  expect(await call({ type: 'inventory' })).toMatchObject([{ online: false, workspace: { pods: [{ id: pod.id, online: false }] } }])
  await expect(call({ type: 'read', runtimeId: actor.id, podId: pod.id })).rejects.toThrow('pod_offline')
  await expect(call({ ...submit, id: randomUUID(), revision: 2 })).rejects.toThrow('pod_offline')
})

it.each(['before publication', 'after commit'])('reconciles a lost response %s without executing the command twice', async (failure) => {
  const { root, projection, actor, pod, details } = fixture()
  let now = Date.now(); let failed = false; let executed = false
  const server = new WorkspaceStore(':memory:', () => now); cleanup.push(() => server.close())
  const execute = vi.fn(async () => { executed = true; return details.execute({ type: 'describe', podId: pod.id, revision: 0, text: 'Recovered result' }) })
  const forward = relay(server, actor)
  const request = async (body: Record<string, unknown>): Promise<unknown> => {
    if (body.type === 'operation') return server.operation(actor.owner, String(body.id))
    const result = await forward(body)
    if (body.type === 'publish' && body.completion && failure === 'after commit' && !failed) { failed = true; now += 30001; throw new Error('Publication response lost') }
    return result
  }
  const controller = new CentralController(root, request, { snapshot: async () => {
    if (executed && failure === 'before publication' && !failed) { failed = true; now += 30001; throw new Error('Snapshot interrupted') }
    return projection.snapshot(actor.owner)
  }, execute, gate: async () => {} }, '/unused-no-artifacts')
  cleanup.push(() => controller.stop()); controller.start()
  await vi.waitFor(() => expect(controller.available, controller.error ?? '').toBe(true))
  const id = randomUUID()
  server.submit(actor.owner, actor.id, 1, { channel: 'details', body: { type: 'describe', podId: pod.id, revision: 0, text: 'Recovered result' } }, id)
  await vi.waitFor(() => expect(server.operation(actor.owner, id).state, controller.error ?? '').toBe('applied'), { timeout: 6000 })
  await vi.waitFor(() => expect(controller.available, controller.error ?? '').toBe(true), { timeout: 6000 })
  expect(failed).toBe(true)
  expect(execute).toHaveBeenCalledOnce()
  expect(server.read(actor.owner, actor.id, pod.id).pod.details.description?.text).toBe('Recovered result')
}, 12000)

const fast = { heartbeatMs: 100, publishIntervalMs: 0 }
function connected(options: { request?: (forward: (body: Record<string, unknown>) => Promise<unknown>, body: Record<string, unknown>) => Promise<unknown>, executor?: Partial<CentralExecutor> } = {}) {
  const { root, projection, actor, pod, store, details } = fixture()
  const server = new WorkspaceStore(':memory:'); cleanup.push(() => server.close())
  const forward = relay(server, actor)
  const requests: Record<string, unknown>[] = []
  const request = async (body: Record<string, unknown>) => { requests.push(body); return options.request ? options.request(forward, body) : forward(body) }
  const gates: number[] = []
  const executor: CentralExecutor = { snapshot: async () => projection.snapshot(actor.owner), execute: async () => null, gate: async (until) => { gates.push(until) }, ...options.executor }
  const controller = new CentralController(root, request, executor, '/unused-no-artifacts', fast)
  cleanup.push(() => controller.stop())
  return { controller, server, actor, pod, store, details, requests, gates, root }
}

it('keeps heartbeats and the scheduling lease alive while a large publication is still uploading', async () => {
  let release!: () => void
  const hold = new Promise<void>((resolve) => { release = resolve })
  let holding = false
  const { controller, details, pod, gates, requests } = connected({ request: async (forward, body) => {
    if (body.type === 'parts' && holding) await hold
    return forward(body)
  } })
  cleanup.push(() => release())
  controller.start()
  await vi.waitFor(() => expect(controller.available, controller.error ?? '').toBe(true))
  holding = true
  const mark = requests.length
  await details.execute({ type: 'describe', podId: pod.id, revision: 0, text: 'A change that must be published' })
  await vi.waitFor(() => expect(requests.slice(mark).some(item => item.type === 'parts')).toBe(true), { timeout: 5000 })
  const before = requests.filter(item => item.type === 'heartbeat').length
  const leases = gates.length
  await vi.waitFor(() => expect(requests.filter(item => item.type === 'heartbeat').length).toBeGreaterThan(before + 2), { timeout: 5000 })
  expect(gates.slice(leases).every(until => until > Date.now())).toBe(true)
  expect(controller.status()).toMatchObject({ state: 'online', error: null })
  release()
  await vi.waitFor(() => expect(controller.status().lastPublication).not.toBeNull())
})

it('publishes complete snapshots to an older service that has no part format', async () => {
  const { controller, server, actor, requests } = connected({ request: async (forward, body) => {
    if (body.type === 'parts' || (body.type === 'publish' && body.format === 2)) throw new Error('Unsupported by an older service')
    const result = await forward(body)
    if (body.type === 'begin') { const { format: _format, manifest: _manifest, runtimeId: _runtimeId, ...legacy } = result as Record<string, unknown>; return legacy }
    return result
  } })
  controller.start()
  await vi.waitFor(() => expect(controller.available, controller.error ?? '').toBe(true))
  expect(controller.status().format).toBe(1)
  expect(requests.some(item => item.type === 'publish' && 'snapshot' in item)).toBe(true)
  expect(server.inventory(actor.owner)[0]?.online).toBe(true)
})

it('names the failing phase as the offline reason in status, inventory and MCP errors', async () => {
  const { controller, actor } = connected({ executor: { snapshot: async () => { throw new Error('Worker response timed out; reload state before retrying') } } })
  controller.start()
  await vi.waitFor(() => expect(controller.error).toBe('worker snapshot: Worker response timed out; reload state before retrying'))
  expect(controller.status()).toMatchObject({ state: 'connecting', runtimeId: actor.id })
  await expect(controller.local(async () => 'never')).rejects.toThrow('Central workspace offline: worker snapshot: Worker response timed out')
  expect(await controller.query({ type: 'inventory' })).toMatchObject([{ id: actor.id, online: false, desktop: { state: 'connecting', error: 'worker snapshot: Worker response timed out; reload state before retrying' } }])
})

it('refuses workspace queries before the first lease instead of sending an empty lease', async () => {
  const { controller, requests } = connected()
  await expect(controller.query({ type: 'inventory' })).rejects.toThrow('Central workspace offline: connecting')
  expect(requests).toEqual([])
})

it('does not rebuild the snapshot while the worker reports no data change', async () => {
  let version = 1
  const snapshot = vi.fn()
  const { controller, requests } = connected({ executor: { version: async () => version } })
  const executor = (controller as unknown as { executor: CentralExecutor }).executor
  const original = executor.snapshot
  executor.snapshot = async () => { snapshot(); return original() }
  controller.start()
  await vi.waitFor(() => expect(controller.available, controller.error ?? '').toBe(true))
  const claims = requests.filter(item => item.type === 'claim').length
  await vi.waitFor(() => expect(requests.filter(item => item.type === 'claim').length).toBeGreaterThan(claims + 2), { timeout: 5000 })
  expect(snapshot).toHaveBeenCalledOnce()
  version++
  await vi.waitFor(() => expect(snapshot).toHaveBeenCalledTimes(2), { timeout: 5000 })
})

it('rebuilds a format-2 journal the service refuses instead of retrying it forever', async () => {
  const { controller, root } = connected()
  mkdirSync(join(root, 'central'), { recursive: true })
  writeFileSync(join(root, 'central/publication.json'), JSON.stringify({ id: randomUUID(), revision: 0, format: 2, hash: 'f'.repeat(64), changes: {}, parts: {} }))
  controller.start()
  await vi.waitFor(() => expect(controller.available, controller.error ?? '').toBe(true))
})

it('alerts the owner once after five minutes offline and again when scheduling resumes', () => {
  const since = 1_000_000
  expect(offlineAlert({ state: 'reconnecting', since }, false, since + 60000)).toBeNull()
  expect(offlineAlert({ state: 'offline', since }, false, since + 5 * 60000)).toBe('alert')
  expect(offlineAlert({ state: 'offline', since }, true, since + 10 * 60000)).toBeNull()
  expect(offlineAlert({ state: 'online', since }, true, since + 11 * 60000)).toBe('recovered')
  expect(centralState(false, null, since, since + 10 * 60000)).toBe('connecting')
  expect(centralState(false, since - 1, since, since + 60000)).toBe('reconnecting')
  expect(centralState(false, since - 1, since, since + 3 * 60000)).toBe('offline')
  expect(partBatches({ a: 'x'.repeat(10), b: 'y'.repeat(10), c: 'z'.repeat(30) }, 25).map(Object.keys)).toEqual([['a', 'b'], ['c']])
})

it('reassembles the projected snapshot exactly from parts and keeps each run history entry small', () => {
  const { store, projection, actor, pod } = fixture()
  for (let index = 0; index < 3; index++) {
    const id = randomUUID()
    store.db.prepare('INSERT INTO runs VALUES(?,?,?,\'completed\',?,?,?,NULL,0,0)').run(id, pod.id, 'b'.repeat(64), index, index + 1, `Run ${index}`)
    store.db.prepare('INSERT INTO run_events VALUES(?,1,\'log\',?,?)').run(id, JSON.stringify({ index }), index)
  }
  const snapshot = projection.snapshot(actor.owner)
  const parts = splitSnapshot(snapshot)
  expect(assembleSnapshot(key => parts.get(key), [...parts.keys()])).toEqual(snapshot)
  const view = snapshot.pods[0]!
  for (const entry of Object.values(view.history)) expect(entry.runs).toHaveLength(1)
  expect(view.runs.events).toEqual(view.history[view.runs.runs[0]!.id]!.events)
})

it('publishes only TypeSafe availability through both full and partitioned central snapshots', async () => {
  const { store, projection, actor, pod } = fixture()
  const { SetupControl } = await import('../src/worker/onboarding/control')
  const setup = new SetupControl(store, new ResourceRegistry(store, () => {})); const id = randomUUID()
  setup.execute({ type: 'save', connection: { id, provider: 'typesafe', account: 'TypeSafe / Jev', state: 'ready', error: null }, metadata: { verifiedAt: 12, private: 'not-for-central' } })
  const snapshot = projection.snapshot(actor.owner)
  const parts = splitSnapshot(snapshot)
  const restored = assembleSnapshot(key => parts.get(key), [...parts.keys()])
  expect(restored.workspace.jev).toEqual({ id, state: 'ready', verifiedAt: 12 })
  expect(restored.pods.find(item => item.id === pod.id)?.resources.jev).toEqual(restored.workspace.jev)
  expect(JSON.stringify(restored)).not.toContain('not-for-central')
  setup.execute({ type: 'save', connection: { id, provider: 'typesafe', account: 'TypeSafe / Jev', state: 'expired', error: null }, metadata: { verifiedAt: 12 } })
  expect(projection.snapshot(actor.owner).workspace.jev?.state).toBe('expired')
})
