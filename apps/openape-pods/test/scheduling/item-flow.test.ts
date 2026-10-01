// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { RunRetention } from '../../src/worker/data/run-retention'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { installExample } from '../../src/worker/runs/examples'
import * as domains from '../../src/worker/recovery/domains'
import { executeScript } from '../../src/worker/runs/runner'
import { closeGraphs, graphFixture as fixture } from './graph-fixture'
import { closeNetworks, networkFixture } from './network-fixture'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
afterEach(closeGraphs)
afterEach(closeNetworks)

it('settles persistent consumer A while B is held, deduplicates source versions and preserves paused work', async () => {
  const f = networkFixture()
  let releaseB: (() => void) | undefined
  const received: string[] = []
  const source = f.pod('Source', { takes: [], gives: ['test.a', 'test.b'], summary: 'Emits synthetic metadata' }, async (_items, request) => {
    for (const channel of ['test.a', 'test.b']) await request('network.emit', { channel, key: 'record-1', sourceItemId: 'record-1', sourceVersion: 'v1', payload: { subject: 'Synthetic item' } })
  })
  const a = f.pod('Consumer A', { takes: ['test.a'], gives: [], summary: 'Consumes A' }, async (items) => { received.push(...items.map(item => item.channel)) })
  const b = f.pod('Consumer B', { takes: ['test.b'], gives: [], summary: 'Consumes B' }, async (items, _request, _input, signal) => {
    received.push(...items.map(item => item.channel))
    await new Promise<void>((resolve) => { releaseB = resolve; signal.addEventListener('abort', () => resolve(), { once: true }) })
  })
  const id = f.create([{ podId: source, source: { schedule: null }, serialCase: false }, ...[a, b].map(podId => ({ podId, source: null, serialCase: true }))], ['test.a', 'test.b'])
  expect(f.engine.view().networks[0]!.state).toBe('paused')
  f.engine.execute({ type: 'activate', id, revision: 1 })
  f.process(id, [source])
  await vi.waitFor(() => expect(f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0))
  f.engine.tick()
  try {
    await vi.waitFor(() => expect(releaseB).toBeTypeOf('function'))
    await vi.waitFor(() => expect(f.store.db.prepare('SELECT state FROM network_deliveries d JOIN network_subscriptions s ON s.id=d.subscription_id WHERE s.pod_id=?').get(a)!.state).toBe('done'))
    expect(f.store.db.prepare('SELECT d.state FROM network_deliveries d JOIN network_subscriptions s ON s.id=d.subscription_id WHERE s.pod_id=?').get(b)!.state).toBe('claimed')
    expect(f.store.db.prepare('SELECT count(*) AS count FROM workflow_runs').get()!.count).toBe(0)
    f.engine.execute({ type: 'pause', id, revision: 1 })
  }
  finally { releaseB?.() }
  await vi.waitFor(() => expect(f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0))
  expect(f.engine.view().networks[0]).toMatchObject({ state: 'paused', counts: { done: 2, claimed: 0 } })
  f.process(id, [source])
  await vi.waitFor(() => expect(f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0))
  f.engine.tick()
  expect(f.started.filter(podId => podId === source)).toHaveLength(2)
  expect(f.started.filter(podId => podId === a)).toHaveLength(1)
  expect(f.started.filter(podId => podId === b)).toHaveLength(1)
  expect(received.sort()).toEqual(['test.a', 'test.b'])
  expect(f.store.db.prepare('SELECT count(*) AS count FROM network_events').get()!.count).toBe(2)
  expect(f.store.db.prepare('SELECT count(*) AS count FROM network_deliveries').get()!.count).toBe(2)
})

function simpleNetwork() {
  const f = networkFixture()
  const source = f.pod('Source', { takes: [], gives: ['test.a'], summary: 'Emits metadata' }, async (_items, request) => {
    await request('network.emit', { channel: 'test.a', key: 'record-1', sourceItemId: 'record-1', sourceVersion: 'v1', payload: { subject: 'Synthetic item' } })
  })
  const consumer = f.pod('Consumer', { takes: ['test.a'], gives: [], summary: 'Consumes metadata' }, async () => {})
  const id = f.create([{ podId: source, source: { schedule: null }, serialCase: false }, { podId: consumer, source: null, serialCase: true }], ['test.a'])
  return { ...f, source, consumer, id }
}

it('does not invoke an empty consumer and activation is idempotent', () => {
  const f = simpleNetwork()
  f.engine.execute({ type: 'activate', id: f.id, revision: 1 })
  f.engine.execute({ type: 'activate', id: f.id, revision: 1 })
  expect(f.store.db.prepare('SELECT count(*) AS count FROM network_trace_events WHERE kind=\'network-activated\'').get()!.count).toBe(1)
  f.engine.tick()
  f.process(f.id, [f.consumer])
  expect(f.started).toEqual([])
  expect(f.store.db.prepare('SELECT count(*) AS count FROM network_invocations').get()!.count).toBe(0)
})

it('requires paused-instance review and rejects changed or consumed processing previews', async () => {
  const f = simpleNetwork()
  f.store.db.prepare('UPDATE pods SET lifecycle=\'paused\' WHERE id=?').run(f.source)
  const selection = { type: 'preview' as const, id: f.id, revision: 1, podIds: [f.source], pausedPodIds: [], budget: 1 }
  expect(() => f.engine.execute(selection)).toThrow('explicit review')
  const preview = f.engine.execute({ ...selection, pausedPodIds: [f.source] }).preview!
  f.store.db.prepare('UPDATE pods SET name=? WHERE id=?').run('Changed source', f.source)
  expect(() => f.engine.execute({ type: 'process', id: f.id, revision: 1, previewId: preview.id })).toThrow('configuration changed')
  const current = f.engine.execute({ ...selection, pausedPodIds: [f.source] }).preview!
  f.engine.execute({ type: 'process', id: f.id, revision: 1, previewId: current.id })
  expect(() => f.engine.execute({ type: 'process', id: f.id, revision: 1, previewId: current.id })).toThrow('already consumed')
  await vi.waitFor(() => expect(f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0))
  f.engine.tick()
  expect(f.started).toEqual([f.source])
  expect(f.store.getPod(f.source).lifecycle).toBe('paused')
  expect(f.engine.view().networks[0]!.counts.pending).toBe(1)
})

it('stops further Process-now admissions on pause while allowing the admitted source to settle', async () => {
  const f = simpleNetwork()
  let release: (() => void) | undefined
  f.behaviours.set(f.source, async (_items, request) => {
    await request('network.emit', { channel: 'test.a', key: 'record-1', sourceItemId: 'record-1', sourceVersion: 'v1', payload: { subject: 'Synthetic item' } })
    await new Promise<void>((resolve) => { release = resolve })
  })
  f.process(f.id, [f.source, f.consumer], [], 2)
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  f.engine.execute({ type: 'pause', id: f.id, revision: 1 })
  release!()
  await vi.waitFor(() => expect(f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0))
  f.engine.tick()
  expect(f.started).toEqual([f.source])
  expect(f.engine.view().networks[0]!.counts.pending).toBe(1)
  f.process(f.id, [f.consumer])
  await vi.waitFor(() => expect(f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0))
  expect(f.started).toEqual([f.source, f.consumer])
})

it('does not fence unrelated ready cases after a clean consumer failure', async () => {
  const f = simpleNetwork()
  f.process(f.id, [f.source])
  await vi.waitFor(() => expect(f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0))
  f.behaviours.set(f.consumer, async () => { throw new Error('Synthetic data failure') })
  f.process(f.id, [f.consumer])
  await vi.waitFor(() => expect(f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0))
  expect(f.engine.view().networks[0]!.counts.blocked).toBe(1)
  f.behaviours.set(f.source, async (_items, request) => { await request('network.emit', { channel: 'test.a', key: 'record-2', sourceItemId: 'record-2', sourceVersion: 'v1', payload: { subject: 'Unrelated item' } }) })
  f.process(f.id, [f.source])
  await vi.waitFor(() => expect(f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0))
  f.behaviours.set(f.consumer, async () => {})
  f.process(f.id, [f.consumer])
  await vi.waitFor(() => expect(f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0))
  expect(f.engine.view().networks[0]!.counts).toMatchObject({ blocked: 1, done: 1 })
  expect(f.started.filter(id => id === f.consumer)).toHaveLength(2)
})

it('waits for a global slot without consuming the rest of a Process-now batch', async () => {
  const f = simpleNetwork()
  f.store.db.prepare('UPDATE settings SET concurrency=1 WHERE id=1').run()
  const busy = f.pod('Unrelated work', { takes: [], gives: ['test.a'], summary: 'Unrelated fixture' }, async () => {})
  const reserved = f.dispatcher.runs.reserve(busy, f.store.getPod(busy).activeScript!, 0, { reason: 'manual', eventIds: [] })
  f.process(f.id, [f.source])
  expect(f.started).toEqual([])
  expect(f.store.db.prepare('SELECT 1 FROM network_trace_events WHERE kind=\'process-now-finished\'').get()).toBeUndefined()
  f.dispatcher.runs.finish(reserved.run.id, 'completed', 'Unrelated fixture completed', null)
  f.engine.tick()
  await vi.waitFor(() => expect(f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0))
  expect(f.started).toEqual([f.source])
})

it('waits for revoked-run cleanup before completing dispatcher shutdown', async () => {
  const f = simpleNetwork()
  let release: (() => void) | undefined
  vi.spyOn(domains, 'confirmDomainsStopped').mockImplementation(async () => { await new Promise<void>((resolve) => { release = resolve }) })
  f.behaviours.set(f.source, async () => { f.store.db.prepare('UPDATE pods SET revision=revision+1 WHERE id=?').run(f.source) })
  f.process(f.id, [f.source])
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  let stopped = false
  const shutdown = (async () => { await f.dispatcher.stop(); stopped = true })()
  await Promise.resolve()
  expect(stopped).toBe(false)
  release!(); await shutdown
  expect(stopped).toBe(true)
  expect(f.store.db.prepare('SELECT state FROM network_invocations').get()!.state).toBe('interrupted')
})

it('keeps a revoked invocation fenced without committing its buffered outputs', async () => {
  const f = simpleNetwork()
  f.behaviours.set(f.source, async (_items, request) => {
    await request('network.emit', { channel: 'test.a', key: 'record-1', sourceItemId: 'record-1', sourceVersion: 'v1', payload: { subject: 'Synthetic item' } })
    f.store.db.prepare('UPDATE pods SET revision=revision+1 WHERE id=?').run(f.source)
  })
  f.process(f.id, [f.source])
  await vi.waitFor(() => expect(f.store.db.prepare('SELECT state FROM network_invocations').get()!.state).toBe('interrupted'))
  expect(f.store.db.prepare('SELECT count(*) AS count FROM network_events').get()!.count).toBe(0)
  expect(f.store.db.prepare('SELECT boot_id FROM run_leases').get()!.boot_id).toMatch(/^fenced:/)
  expect(f.store.db.prepare('SELECT state FROM runs').get()!.state).toBe('interrupted')
  expect(f.store.checkpoint(f.source)).toMatchObject({ revision: 0, body: {} })
  await f.dispatcher.stop()
})

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
