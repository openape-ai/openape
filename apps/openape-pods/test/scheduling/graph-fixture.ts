import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, vi } from 'vitest'
import type { GraphContract } from '../../src/contracts/graphs'
import type { AgentRuntime } from '../../src/worker/agent/executor'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { RunDispatcher } from '../../src/worker/runs/dispatcher'
import type { RunServices } from '../../src/worker/runs/dispatcher'
import { installExample } from '../../src/worker/runs/examples'
import { executeScript } from '../../src/worker/runs/runner'
import { PodDatabase } from '../../src/worker/storage/database'
import { WorkflowEngine } from '../../src/worker/workflows/engine'

export interface Item { key: string, channel: string, data: Record<string, unknown> }
export type Emit = (channel: string, item: { key: string, data: Record<string, unknown>, reason?: string, confidence?: number }) => Promise<unknown>
export type Behaviour = (items: Item[], emit: Emit, variables: Record<string, string>, request: (operation: string, payload: unknown) => Promise<unknown>) => Promise<void>
const stores: PodDatabase[] = []
export function closeGraphs(): void { vi.restoreAllMocks(); for (const store of stores.splice(0)) { store.close(); rmSync(store.root, { recursive: true, force: true }) } }

/** A real store, engine and dispatcher. Only the sandboxed script process is replaced by a behaviour per Pod. */
export function graphFixture(gates: unknown[] = [], services: RunServices = { gate: async body => (body as { operation: string }).operation === 'create' ? { id: randomUUID(), url: 'https://id.example.test/grant-approval?grant_id=fixture' } : 'pending' }) {
  const store = new PodDatabase(mkdtempSync(join(tmpdir(), 'pods-graph-run-'))); stores.push(store)
  const resources = new ResourceRegistry(store, () => {})
  vi.spyOn(resources, 'capture').mockResolvedValue({ id: randomUUID(), files: [] } as never)
  const dispatcher = new RunDispatcher(store, resources, { helper: '/unused', environment: {} } as AgentRuntime, services)
  const engine = new WorkflowEngine(store, dispatcher, { inspect: vi.fn(async () => {}) })
  const behaviours = new Map<string, Behaviour>(); const started: string[] = []; const contracts: Record<string, GraphContract> = {}
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, input, signal, hooks) => {
    started.push(input.podId)
    const items = await hooks.request('graph.contract', contracts[input.podId], signal) as Item[]
    await behaviours.get(input.podId)!(items, (name, item) => hooks.request('graph.emit', { ...item, channel: name }, signal), input.variables ?? {}, (operation, payload) => hooks.request(operation, payload, signal))
    return { status: 'completed', summary: 'done', completedInputIds: input.eventIds, gapIds: [] }
  })
  const pod = (name: string, contract: GraphContract, behaviour: Behaviour) => {
    const { id } = store.createPod({ name }); installExample(store, resources, id, 'deterministic', 'a'.repeat(64))
    const row = store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=?').get(id)!
    store.db.prepare('UPDATE scripts SET manifest=? WHERE pod_id=?').run(JSON.stringify({ ...JSON.parse(String(row.manifest)), contract }), id)
    contracts[id] = contract; behaviours.set(id, behaviour)
    return id
  }
  const id = randomUUID()
  const channel = (name: string) => ({ name, title: name, fields: ['subject'] })
  const save = (pods: string[], channels: string[]) => engine.save({ type: 'save', id, revision: 0, name: 'Mail', nodes: pods.map(podId => ({ podId, after: [], handoff: false })), schedule: null, enabled: false, mode: 'channels', groupId: null, channels: channels.map(channel), gates: gates as never, values: [{ name: 'threshold', value: '0.8', revision: 0 }] })
  /** Drives one graph run until no node is left to start. */
  const run = async () => {
    const runId = engine.start(id, engine.view().workflows[0]!.revision)
    for (let round = 0; round < 12 && !['completed', 'blocked'].includes(engine.run(runId).state); round++) {
      engine.tick()
      await vi.waitFor(() => expect(store.db.prepare('SELECT count(*) AS count FROM run_leases').get()?.count).toBe(0))
    }
    return engine.run(runId)
  }
  const trace = (key: string) => store.db.prepare('SELECT node,outcome,channel,reason,confidence FROM graph_item_events WHERE workflow_id=? AND key=? ORDER BY id').all(id, key)
  const pending = (node: string) => store.db.prepare('SELECT i.key FROM graph_deliveries d JOIN graph_items i ON i.id=d.item_id WHERE d.node=? AND d.state=\'pending\' ORDER BY i.key').all(node).map(row => row.key)
  const count = (table: string) => store.db.prepare(`SELECT count(*) AS count FROM ${table}`).get()!.count as number
  return { store, engine, id, pod, save, run, trace, pending, count, started, behaviours }
}
