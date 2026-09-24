// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
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
import { CentralController } from '../src/main/central/controller'
import { WorkspaceStore } from '../../openape-pods-relay/server/utils/workspace-store'
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
  const request = async (body: Record<string, unknown>): Promise<unknown> => {
    const lease = String(body.lease)
    if (body.type === 'inventory') return server.inventory(actor.owner)
    if (body.type === 'read') return server.read(actor.owner, String(body.runtimeId), String(body.podId))
    if (body.type === 'operation') return server.visibleOperation(actor.owner, String(body.id))
    if (body.type === 'submit') return server.submit(actor.owner, String(body.runtimeId), Number(body.revision), body.command as Parameters<WorkspaceStore['submit']>[3], String(body.id))
    if (body.type === 'begin') return server.begin(actor)
    if (body.type === 'publish') return server.publish(actor, lease, String(body.id), Number(body.revision), body.snapshot, body.completion as Parameters<WorkspaceStore['publish']>[5])
    if (body.type === 'heartbeat') return server.heartbeat(actor, lease, String(body.hash))
    if (body.type === 'claim') return server.claim(actor, lease)
    if (body.type === 'disconnect') return server.disconnect(actor, lease)
    throw new Error(`Unexpected request ${String(body.type)}`)
  }
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
  const archived = server.db.prepare('SELECT snapshot FROM runtimes WHERE id=?').get(actor.id)!.snapshot as string
  expect((JSON.parse(archived) as CentralSnapshot).archive.tables.pod_descriptions).toHaveLength(1)
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
  const request = async (body: Record<string, unknown>): Promise<unknown> => {
    const lease = String(body.lease)
    if (body.type === 'begin') return server.begin(actor)
    if (body.type === 'operation') return server.operation(actor.owner, String(body.id))
    if (body.type === 'publish') {
      const result = server.publish(actor, lease, String(body.id), Number(body.revision), body.snapshot, body.completion as Parameters<WorkspaceStore['publish']>[5])
      if (body.completion && failure === 'after commit' && !failed) { failed = true; now += 30001; throw new Error('Publication response lost') }
      return result
    }
    if (body.type === 'heartbeat') return server.heartbeat(actor, lease, String(body.hash))
    if (body.type === 'claim') return server.claim(actor, lease)
    if (body.type === 'disconnect') return server.disconnect(actor, lease)
    throw new Error(`Unexpected request ${String(body.type)}`)
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
