// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { GraphContract } from '../../src/contracts/graphs'
import type { AgentRuntime } from '../../src/worker/agent/executor'
import { RunRetention } from '../../src/worker/data/run-retention'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { RunDispatcher } from '../../src/worker/runs/dispatcher'
import { installExample } from '../../src/worker/runs/examples'
import { executeScript } from '../../src/worker/runs/runner'
import { PodDatabase } from '../../src/worker/storage/database'
import { WorkflowEngine } from '../../src/worker/workflows/engine'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
const stores: PodDatabase[] = []
afterEach(() => { vi.restoreAllMocks(); for (const store of stores.splice(0)) { store.close(); rmSync(store.root, { recursive: true, force: true }) } })

interface Item { key: string, channel: string, data: Record<string, unknown> }
type Emit = (channel: string, item: { key: string, data: Record<string, unknown>, reason?: string, confidence?: number }) => Promise<unknown>
type Behaviour = (items: Item[], emit: Emit, variables: Record<string, string>) => Promise<void>
const channel = (name: string) => ({ name, title: name, fields: ['subject'] })

function fixture(gates: unknown[] = []) {
  const store = new PodDatabase(mkdtempSync(join(tmpdir(), 'pods-item-flow-'))); stores.push(store)
  const resources = new ResourceRegistry(store, () => {})
  vi.spyOn(resources, 'capture').mockResolvedValue({ id: randomUUID(), files: [] } as never)
  const dispatcher = new RunDispatcher(store, resources, { helper: '/unused', environment: {} } as AgentRuntime)
  const engine = new WorkflowEngine(store, dispatcher, { inspect: vi.fn(async () => {}) })
  const behaviours = new Map<string, Behaviour>(); const started: string[] = []; const contracts: Record<string, GraphContract> = {}
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, input, signal, hooks) => {
    started.push(input.podId)
    const items = await hooks.request('graph.contract', contracts[input.podId], signal) as Item[]
    await behaviours.get(input.podId)!(items, (name, item) => hooks.request('graph.emit', { ...item, channel: name }, signal), input.variables ?? {})
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
  const save = (pods: string[], channels: string[]) => engine.save({ type: 'save', id, revision: 0, name: 'Mail', nodes: pods.map(podId => ({ podId, after: [], handoff: false })), schedule: null, enabled: false, mode: 'channels', groupId: null, channels: channels.map(channel), gates: gates as never, values: [{ name: 'threshold', value: '0.8', revision: 0 }] })
  /** Drives one graph run until no node is left to start. */
  const run = async () => {
    const runId = engine.start(id, 1)
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

const keys = ['mail-1', 'mail-2', 'mail-3', 'mail-4', 'mail-5']
function mailGraph(f: ReturnType<typeof fixture>) {
  const received: Record<string, string[]> = { a: [], b: [] }
  const source = f.pod('Source', { takes: [], gives: ['mail.open'], summary: 'Reads mail' }, async (_items, emit) => { for (const key of keys) await emit('mail.open', { key, data: { subject: key } }) })
  const classifier = f.pod('Classifier', { takes: ['mail.open'], gives: ['mail.a', 'mail.b'], summary: 'Sorts mail' }, async (items, emit) => {
    for (const [index, item] of items.entries()) await emit(index < 3 ? 'mail.a' : 'mail.b', { key: item.key, data: item.data, reason: 'Sorted by position', confidence: 0.9 })
  })
  const sinkA = f.pod('Sink A', { takes: ['mail.a'], gives: [], summary: 'Files mail' }, async (items) => { received.a!.push(...items.map(item => item.key)) })
  const sinkB = f.pod('Sink B', { takes: ['mail.b'], gives: [], summary: 'Files mail' }, async (items) => { received.b!.push(...items.map(item => item.key)) })
  f.save([source, classifier, sinkA, sinkB], ['mail.open', 'mail.a', 'mail.b'])
  return { source, classifier, sinkA, sinkB, received }
}

it('routes five items into two channels and records every node each item passed', async () => {
  const f = fixture(); const g = mailGraph(f)
  expect((await f.run()).state).toBe('completed')
  expect(f.started).toEqual([g.source, g.classifier, g.sinkA, g.sinkB])
  expect(g.received).toEqual({ a: ['mail-1', 'mail-2', 'mail-3'], b: ['mail-4', 'mail-5'] })
  expect(f.trace('mail-1')).toEqual([
    { node: g.source, outcome: 'emitted', channel: 'mail.open', reason: null, confidence: null },
    { node: g.classifier, outcome: 'consumed', channel: 'mail.open', reason: null, confidence: null },
    { node: g.classifier, outcome: 'emitted', channel: 'mail.a', reason: 'Sorted by position', confidence: 0.9 },
    { node: g.sinkA, outcome: 'consumed', channel: 'mail.a', reason: null, confidence: null },
  ])
  expect(f.trace('mail-5').map(event => event.node)).toEqual([g.source, g.classifier, g.classifier, g.sinkB])
  expect(f.count('graph_deliveries WHERE state=\'pending\'')).toBe(0)
})

it('leaves the deliveries of a failed sink pending and delivers them exactly once on retry', async () => {
  const f = fixture(); const g = mailGraph(f)
  f.behaviours.set(g.sinkA, async () => { throw new Error('Folder is unavailable') })
  const blocked = await f.run()
  expect(blocked.state).toBe('blocked')
  expect(g.received).toEqual({ a: [], b: ['mail-4', 'mail-5'] })
  expect(f.pending(g.sinkA)).toEqual(['mail-1', 'mail-2', 'mail-3'])
  expect(f.trace('mail-1').at(-1)).toMatchObject({ node: g.sinkA, outcome: 'failed' })
  f.behaviours.set(g.sinkA, async (items) => { g.received.a!.push(...items.map(item => item.key)) })
  await f.engine.retry(blocked.id, g.sinkA)
  await vi.waitFor(() => expect(f.pending(g.sinkA)).toEqual([]))
  f.engine.tick()
  expect(f.engine.run(blocked.id).state).toBe('completed')
  expect(g.received.a).toEqual(['mail-1', 'mail-2', 'mail-3'])
  expect(f.trace('mail-1').filter(event => event.node === g.sinkA).map(event => event.outcome)).toEqual(['failed', 'consumed'])
})

it('hands nothing on when the emitting run fails after its emits', async () => {
  const f = fixture(); const g = mailGraph(f)
  f.behaviours.set(g.classifier, async (items, emit) => { await emit('mail.a', { key: items[0]!.key, data: {} }); throw new Error('Model is unavailable') })
  expect((await f.run()).state).toBe('blocked')
  expect(f.started).toEqual([g.source, g.classifier])
  expect(f.count('graph_items WHERE channel!=\'mail.open\'')).toBe(0)
  expect(f.pending(g.classifier)).toEqual(keys)
})

it('skips a node without pending items and starts no run for it', async () => {
  const f = fixture(); const g = mailGraph(f)
  f.behaviours.set(g.source, async () => {})
  const run = await f.run()
  expect(run.state).toBe('completed')
  expect(f.started).toEqual([g.source])
  expect(run.nodes.filter(node => node.runId === null).map(node => node.reason)).toEqual(['No items to process', 'No items to process', 'No items to process'])
})

it('holds items at a gate across runs and starts nothing behind it', async () => {
  const f = fixture([{ key: 'batch', title: 'Batch', kind: 'approve', takes: 'mail.open', gives: 'mail.approved', excluded: null }])
  const source = f.pod('Source', { takes: [], gives: ['mail.open'], summary: 'Reads mail' }, async (_items, emit) => { await emit('mail.open', { key: `mail-${f.count('graph_items')}`, data: {} }) })
  const archive = f.pod('Archive', { takes: ['mail.approved'], gives: [], summary: 'Archives mail' }, async () => {})
  f.save([source, archive], ['mail.open', 'mail.approved'])
  expect((await f.run()).state).toBe('completed')
  f.store.db.prepare('UPDATE workflows SET revision=1').run()
  expect((await f.run()).state).toBe('completed')
  expect(f.pending('gate:batch')).toEqual(['mail-0', 'mail-1'])
  expect(f.started).toEqual([source, source])
})

it('passes graph values to the script and lets a Pod variable of another name stand beside them', async () => {
  const f = fixture(); let seen: Record<string, string> = {}
  const source = f.pod('Source', { takes: [], gives: [], summary: 'Reads mail' }, async (_items, _emit, variables) => { seen = variables })
  f.save([source], [])
  await f.run()
  expect(seen).toEqual({ threshold: '0.8' })
})

it('reads a run snapshot without a mode as a sequence', async () => {
  const f = fixture(); const { id: a } = f.store.createPod({ name: 'Old' })
  installExample(f.store, new ResourceRegistry(f.store, () => {}), a, 'deterministic', 'a'.repeat(64))
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, input) => ({ status: 'completed', summary: 'done', completedInputIds: input.eventIds, gapIds: [] }))
  f.engine.save({ type: 'save', id: f.id, revision: 0, name: 'Old', nodes: [{ podId: a, after: [], handoff: false }], schedule: null, enabled: false })
  const runId = f.engine.start(f.id, 1)
  const { mode: _mode, groupId: _group, channels: _channels, gates: _gates, values: _values, ...old } = JSON.parse(String(f.store.db.prepare('SELECT definition FROM workflow_runs WHERE id=?').get(runId)!.definition))
  f.store.db.prepare('UPDATE workflow_runs SET definition=? WHERE id=?').run(JSON.stringify(old), runId)
  f.engine.tick()
  await vi.waitFor(() => expect(f.count('run_leases')).toBe(0))
  f.engine.tick()
  expect(f.engine.run(runId).state).toBe('completed')
})

it('keeps the items of the three most recent runs and every pending item', async () => {
  const f = fixture([{ key: 'batch', title: 'Batch', kind: 'approve', takes: 'mail.held', gives: 'mail.approved', excluded: null }])
  let round = 0
  const source = f.pod('Source', { takes: [], gives: ['mail.open', 'mail.held'], summary: 'Reads mail' }, async (_items, emit) => {
    round++
    await emit('mail.open', { key: `open-${round}`, data: {} })
    if (round === 1) await emit('mail.held', { key: 'held-1', data: {} })
  })
  const sink = f.pod('Sink', { takes: ['mail.open'], gives: [], summary: 'Files mail' }, async () => {})
  const archive = f.pod('Archive', { takes: ['mail.approved'], gives: [], summary: 'Archives mail' }, async () => {})
  f.save([source, sink, archive], ['mail.open', 'mail.held', 'mail.approved'])
  for (let index = 0; index < 5; index++) expect((await f.run()).state).toBe('completed')
  await new RunRetention(f.store).prune()
  expect(f.store.db.prepare('SELECT key FROM graph_items ORDER BY key').all().map(row => row.key)).toEqual(['held-1', 'open-3', 'open-4', 'open-5'])
  expect(f.trace('open-1')).toEqual([])
  expect(f.trace('held-1')).toHaveLength(1)
  expect(f.trace('open-5')).toHaveLength(2)
  expect(f.count('graph_deliveries')).toBe(4)
})
