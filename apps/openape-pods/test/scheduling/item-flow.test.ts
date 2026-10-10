// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { InfrastructureError } from '../../src/contracts/infrastructure'
import * as domains from '../../src/worker/recovery/domains'
import { closeNetworks, networkFixture } from './network-fixture'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
afterEach(async () => { vi.restoreAllMocks(); await closeNetworks() })

it('joins only one explicit case revision, lets complete invoices pass and retains timeout review for late inputs', async () => {
  const f = networkFixture()
  const source = f.pod('Invoice branches', { takes: [], gives: ['left', 'right'], summary: 'Explicit same-source invoice correlation' }, async () => {})
  const consumer = f.pod('Joined invoice', { takes: ['left', 'right'], gives: [], summary: 'Requires both invoice branches' }, async () => {})
  const schema = { type: 'object' as const, properties: { subject: { type: 'string' as const } }, required: ['subject'], additionalProperties: false as const }
  const id = f.engine.execute({ type: 'create', draft: { name: 'Explicit invoice joins', groupId: f.groupId, channels: ['left', 'right'].map(name => ({ name, title: name, schemaVersion: 1, schema })), members: [{ podId: source, source: { schedule: null }, serialCase: false }, { podId: consumer, source: null, serialCase: true }], joins: [{ id: 'invoice', podId: consumer, channels: ['left', 'right'], deadlineMs: 1000, reviewDestination: 'owner' }] } }).createdId!
  const invocations = f.engine.invocations
  async function emit(invoice: string, channels: string[], version = '1') {
    const authority = invocations.reserve(id, source, f.resources.epoch(source), 'manual')!
    await invocations.finish(authority, 'completed', 'Synthetic invoice branch', null, [], channels.map(channel => ({ channel, key: invoice, sourceItemId: invoice, sourceVersion: version, payload: { subject: invoice } })))
  }
  await emit('INV-1', ['left'])
  expect(invocations.reserve(id, consumer, f.resources.epoch(consumer), 'manual')).toBeNull()
  await emit('INV-2', ['left', 'right'])
  f.store.db.prepare('UPDATE network_joins SET deadline=0 WHERE case_id!=?').run(f.store.db.prepare('SELECT case_id FROM network_joins ORDER BY rowid LIMIT 1').get()!.case_id!)
  const joined = invocations.reserve(id, consumer, f.resources.epoch(consumer), 'manual')!
  const batch = invocations.input(joined).items
  expect(batch.map(item => item.data.subject)).toEqual(['INV-2', 'INV-2'])
  expect(new Set(batch.map(item => `${item.caseId}:${item.caseRevision}`)).size).toBe(1)
  await invocations.finish(joined, 'completed', 'One complete invoice', null, batch.map(item => item.eventId), [])
  const incomplete = f.store.db.prepare('SELECT case_id FROM network_joins WHERE state=\'pending\'').get()!.case_id
  f.store.db.prepare('UPDATE network_joins SET deadline=0 WHERE case_id=?').run(incomplete!)
  expect(invocations.reserve(id, consumer, f.resources.epoch(consumer), 'manual')).toBeNull()
  const receipt = f.store.db.prepare('SELECT state,reason FROM network_joins WHERE case_id=?').get(incomplete!)!
  expect(receipt.state).toBe('blocked')
  expect(JSON.parse(receipt.reason as string)).toEqual({ reason: 'Join deadline expired', missing: ['right'], reviewDestination: 'owner' })
  await emit('INV-1', ['right'])
  expect(invocations.reserve(id, consumer, f.resources.epoch(consumer), 'manual')).toBeNull()
  expect(f.store.db.prepare('SELECT count(*) AS count FROM network_join_inputs WHERE case_id=?').get(incomplete!)!.count).toBe(1)
  expect(f.store.db.prepare('SELECT count(*) AS count FROM network_deliveries WHERE case_id=? AND state=\'blocked\'').get(incomplete!)!.count).toBe(2)
  await emit('INV-1', ['left', 'right'], '2')
  const next = invocations.reserve(id, consumer, f.resources.epoch(consumer), 'manual')!
  expect(invocations.input(next).items.map(item => item.caseRevision)).toEqual([2, 2])
  expect(f.store.db.prepare('SELECT state FROM network_joins WHERE case_id=? AND case_revision=1').get(incomplete!)!.state).toBe('blocked')
  f.store.assertStorage()
})

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
  expect(f.engine.view().networks[0]!.counts.retry_wait).toBe(1)
  f.behaviours.set(f.source, async (_items, request) => { await request('network.emit', { channel: 'test.a', key: 'record-2', sourceItemId: 'record-2', sourceVersion: 'v1', payload: { subject: 'Unrelated item' } }) })
  f.process(f.id, [f.source])
  await vi.waitFor(() => expect(f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0))
  f.behaviours.set(f.consumer, async () => {})
  f.process(f.id, [f.consumer])
  await vi.waitFor(() => expect(f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0))
  expect(f.engine.view().networks[0]!.counts).toMatchObject({ retry_wait: 1, done: 1 })
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

it('waits for an instance program lease within the original Process-now deadline', async () => {
  const f = simpleNetwork()
  f.store.db.prepare('INSERT INTO program_leases VALUES(?,?,?,?,?)').run(f.source, 'synthetic-program-session', 'ape-shell', 0, f.store.getPod(f.source).bindingRevision)
  f.process(f.id, [f.source])
  expect(f.started).toEqual([])
  expect(f.store.db.prepare('SELECT 1 FROM network_trace_events WHERE kind=\'process-now-finished\'').get()).toBeUndefined()
  f.store.db.prepare('DELETE FROM program_leases WHERE pod_id=?').run(f.source)
  f.engine.tick()
  await vi.waitFor(() => expect(f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0))
  expect(f.started).toEqual([f.source])
})

it('requires baseline review before activation or manual processing of a restored network', () => {
  const f = simpleNetwork()
  const preview = f.engine.execute({ type: 'preview', id: f.id, revision: 1, podIds: [f.source], pausedPodIds: [], budget: 1 }).preview!
  f.store.db.prepare('UPDATE networks SET baseline_state=\'review_required\' WHERE id=?').run(f.id)
  expect(() => f.engine.execute({ type: 'activate', id: f.id, revision: 1 })).toThrow('reviewed baseline')
  expect(() => f.engine.execute({ type: 'preview', id: f.id, revision: 1, podIds: [f.source], pausedPodIds: [], budget: 1 })).toThrow('reviewed baseline')
  expect(() => f.engine.execute({ type: 'process', id: f.id, revision: 1, previewId: preview.id })).toThrow('reviewed baseline')
  expect(f.started).toEqual([])
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
  await new Promise<void>((resolve) => { setImmediate(resolve) })
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

it('retries the original consumer claim batch without merging a later input for the same case', async () => {
  const f = networkFixture(); let sourceCall = 0; const received: string[][] = []
  const source = f.pod('Source', { takes: [], gives: ['test.a', 'test.b'], summary: 'Synthetic facts' }, async (_items, request) => {
    const channel = sourceCall++ === 0 ? 'test.a' : 'test.b'
    await request('network.emit', { channel, key: 'same-case', sourceItemId: 'same-case', sourceVersion: 'v1', payload: { subject: channel } })
  })
  const consumer = f.pod('Consumer', { takes: ['test.a', 'test.b'], gives: [], summary: 'Synthetic consumer' }, async (items) => { received.push(items.map(item => item.channel)) })
  const id = f.create([{ podId: source, source: { schedule: null }, serialCase: false }, { podId: consumer, source: null, serialCase: true }], ['test.a', 'test.b'])
  f.process(id, [source]); await vi.waitFor(() => expect(f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0))
  let fail = true
  vi.mocked(f.resources.capture).mockImplementation(async (podId) => {
    if (podId === consumer && fail) { fail = false; throw new InfrastructureError({ phase: 'read', retryAfterMs: 0 }) }
    return { id: 'synthetic-snapshot', files: [] } as never
  })
  f.engine.execute({ type: 'activate', id, revision: 1 }); f.engine.tick()
  await vi.waitFor(() => expect(f.engine.view().networks[0]!.counts.retry_wait).toBe(1))
  expect(received).toEqual([])
  const originalRun = f.store.db.prepare('SELECT run_id FROM network_deliveries WHERE state=\'retry_wait\'').get()!.run_id!
  f.engine.execute({ type: 'pause', id, revision: 1 })
  f.process(id, [source]); await vi.waitFor(() => expect(f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0))
  expect(f.store.db.prepare('SELECT count(DISTINCT case_id||case_revision) AS count FROM network_deliveries').get()!.count).toBe(1)
  f.store.db.prepare('UPDATE network_deliveries SET ready_at=? WHERE run_id=?').run(Date.now() - 1, originalRun)
  f.store.db.prepare('UPDATE network_invocation_controls SET retry_at=? WHERE run_id=?').run(Date.now() - 1, originalRun)
  f.process(id, [consumer], [], 1)
  await vi.waitFor(() => expect(received).toEqual([['test.a']]))
  await vi.waitFor(() => expect(f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0))
  expect(f.engine.view().networks[0]!.counts).toMatchObject({ done: 1, pending: 1, retry_wait: 0 })
  f.process(id, [consumer], [], 1)
  await vi.waitFor(() => expect(received).toEqual([['test.a'], ['test.b']]))
  await vi.waitFor(() => expect(f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0))
})

it('retains Process now consumption after trace removal', async () => {
  const f = simpleNetwork()
  const preview = f.engine.execute({ type: 'preview', id: f.id, revision: 1, podIds: [f.source], pausedPodIds: [], budget: 1 }).preview!
  f.engine.execute({ type: 'process', id: f.id, revision: 1, previewId: preview.id })
  await vi.waitFor(() => expect(f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0))
  f.store.db.prepare('DELETE FROM network_trace_events').run()
  expect(() => f.engine.execute({ type: 'process', id: f.id, revision: 1, previewId: preview.id })).toThrow('already consumed')
  expect(f.started.filter(podId => podId === f.source)).toHaveLength(1)
})
