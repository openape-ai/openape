// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { RunRetention } from '../../src/worker/data/run-retention'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { installExample } from '../../src/worker/runs/examples'
import { executeScript } from '../../src/worker/runs/runner'
import { closeGraphs, graphFixture as fixture } from './graph-fixture'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
afterEach(closeGraphs)

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
  // Both sinks become ready in the same tick; which process starts first is not part of the contract.
  expect(f.started.slice(0, 2)).toEqual([g.source, g.classifier])
  expect(f.started.slice(2).sort()).toEqual([g.sinkA, g.sinkB].sort())
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

it('holds items at a gate across runs and hands nothing on without a decision', async () => {
  const f = fixture([{ key: 'batch', title: 'Batch', kind: 'approve', takes: 'mail.open', gives: 'mail.approved', excluded: null }])
  const source = f.pod('Source', { takes: [], gives: ['mail.open'], summary: 'Reads mail' }, async (_items, emit) => { await emit('mail.open', { key: `mail-${f.count('graph_items')}`, data: {} }) })
  const archive = f.pod('Archive', { takes: ['mail.approved'], gives: [], summary: 'Archives mail' }, async () => {})
  f.save([source, archive], ['mail.open', 'mail.approved'])
  expect((await f.run()).state).toBe('completed')
  expect((await f.run()).state).toBe('completed')
  expect(f.pending('gate:batch')).toEqual(['mail-0', 'mail-1'])
  expect(f.pending(archive)).toEqual([])
  expect(f.trace('mail-0').map(event => event.outcome)).toEqual(['emitted', 'held'])
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
  expect(f.trace('held-1').map(event => event.outcome)).toEqual(['emitted', 'held'])
  expect(f.trace('open-5')).toHaveLength(2)
  expect(f.count('graph_deliveries')).toBe(4)
  expect(f.count('graph_gate_batches')).toBe(1)
})
