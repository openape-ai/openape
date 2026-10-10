// @vitest-environment node
import { performance } from 'node:perf_hooks'
import { Scheduler } from '../../src/worker/scheduling/scheduler'
import { scheduleDomains } from '../../src/worker/scheduling/fair-scheduler'
import { executeScript } from '../../src/worker/runs/runner'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { RunDispatcher } from '../../src/worker/runs/dispatcher'
import type { AgentRuntime } from '../../src/worker/agent/executor'
import { NetworkEngine } from '../../src/worker/scheduling/network-engine'
import { pruneNetworkTraces } from '../../src/worker/scheduling/network-maintenance'
import { NetworkRecovery } from '../../src/worker/scheduling/network-recovery'
import { closeNetworks, networkFixture } from './network-fixture'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
afterEach(async () => { await closeNetworks(); vi.restoreAllMocks() })
const loader = createRequire(import.meta.url).resolve('tsx')

function fixture() {
  const f = networkFixture()
  const source = f.pod('Source', { takes: [], gives: ['test.input'], summary: 'Synthetic source' }, async () => {})
  const consumer = f.pod('Consumer', { takes: ['test.input'], gives: ['test.result'], summary: 'Synthetic consumer' }, async () => {})
  const downstream = f.pod('Downstream', { takes: ['test.result'], gives: [], summary: 'Synthetic downstream' }, async () => {})
  const id = f.create([{ podId: source, source: { schedule: null }, serialCase: false }, ...[consumer, downstream].map(podId => ({ podId, source: null, serialCase: true }))], ['test.input', 'test.result'])
  f.engine.execute({ type: 'activate', id, revision: 1 })
  return { ...f, source, consumer, downstream, id }
}

it.each(['beforeAccepted', 'accepted', 'claimed', 'beforeSettlement', 'settled', 'effectIssued', 'effectConfirmed'])('recovers production network transactions after real SIGKILL at %s', async (point) => {
  const f = fixture(); const marker = join(f.store.root, 'synthetic-effect.txt')
  const modules = Object.fromEntries(['storage/database', 'runs/store', 'scheduling/network-invocations'].map(path => [path, resolve(`src/worker/${path}.ts`)]))
  const code = `
    import { PodDatabase, digest } from ${JSON.stringify(modules['storage/database'])};
    import { RunStore } from ${JSON.stringify(modules['runs/store'])};
    import { NetworkInvocations } from ${JSON.stringify(modules['scheduling/network-invocations'])};
    import { writeFileSync } from 'node:fs';
    const store = new PodDatabase(${JSON.stringify(f.store.root)});
    const invocations = new NetworkInvocations(store,new RunStore(store),'/unused');
    const die = () => process.kill(process.pid,'SIGKILL');
    const point = ${JSON.stringify(point)};
    const source = invocations.reserve(${JSON.stringify(f.id)},${JSON.stringify(f.source)},0,'manual');
    invocations.stageProgress(source,{expectedRevision:0,checkpoint:{cursor:'accepted'},sources:[],claims:[]});
    const accept = invocations.events.accept.bind(invocations.events);
    invocations.events.accept = (...args) => { const receipt=accept(...args); if(point==='beforeAccepted')die(); return receipt; };
    await invocations.finish(source,'completed','Synthetic source settled',null,[],[{channel:'test.input',key:'item',sourceItemId:'item',sourceVersion:'v1',payload:{subject:'Synthetic item'}}]);
    if(point==='accepted')die();
    const consumer = invocations.reserve(${JSON.stringify(f.id)},${JSON.stringify(f.consumer)},0,'event');
    if(point==='claimed')die();
    invocations.stageProgress(consumer,{expectedRevision:0,checkpoint:{processed:true},sources:[],claims:[]});
    const input=invocations.input(consumer).items[0];
    if(['effectIssued','effectConfirmed'].includes(point)) {
      const key=digest('synthetic-action');
      store.transaction(()=>{
        store.db.prepare("INSERT INTO network_effect_attempts VALUES(?,1,?,?,1,?,?,'intent',1,?)").run(key,consumer.runId,input.caseId,digest('input'),digest('grant'),${JSON.stringify(f.id)});
        store.db.prepare("INSERT INTO network_effect_receipts VALUES(?,1,1,'intent','{}',1)").run(key);
      });
      writeFileSync(${JSON.stringify(marker)},'issued-once');
      if(point==='effectConfirmed')store.transaction(()=>{
        store.db.prepare("UPDATE network_effect_attempts SET state='confirmed_applied' WHERE logical_action_key=?").run(key);
        store.db.prepare("INSERT INTO network_effect_receipts VALUES(?,1,2,'confirmed_applied','{}',2)").run(key);
      });
      die();
    }
    invocations.events.accept=(...args)=>{const receipt=accept(...args);if(point==='beforeSettlement')die();return receipt;};
    await invocations.finish(consumer,'completed','Synthetic consumer settled',null,[input.eventId],[{channel:'test.result',key:'result',payload:{subject:'Processed'}}]);
    die();
  `
  const child = spawnSync(process.execPath, ['--import', loader, '--input-type=module', '-e', code], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' }, timeout: 20000 })
  expect(child.signal, child.stderr).toBe('SIGKILL')
  const dispatcher = new RunDispatcher(f.store, f.resources, { helper: '/unused', environment: {} } as AgentRuntime)
  const engine = new NetworkEngine(f.store, dispatcher, f.resources, '/unused', () => f.owner)
  try {
    await engine.reconcileStartup()
    const completed = point === 'settled'
    expect(f.store.db.prepare('SELECT count(*) AS count FROM network_events').get()!.count).toBe(point === 'beforeAccepted' ? 0 : completed ? 2 : 1)
    expect(f.store.db.prepare('SELECT count(*) AS count FROM network_event_identities').get()!.count).toBe(point === 'beforeAccepted' ? 0 : completed ? 2 : 1)
    expect(f.store.db.prepare('SELECT revision FROM network_checkpoints WHERE pod_id=?').get(f.source)!.revision).toBe(point === 'beforeAccepted' ? 0 : 1)
    expect(f.store.db.prepare('SELECT revision FROM network_checkpoints WHERE pod_id=?').get(f.consumer)!.revision).toBe(completed ? 1 : 0)
    expect(f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0)
    const count = f.store.db.prepare('SELECT count(*) AS count FROM network_effect_attempts').get()!.count
    if (point === 'effectIssued' || point === 'effectConfirmed') {
      expect(count).toBe(1)
      expect(f.store.db.prepare('SELECT state FROM network_effect_attempts').get()!.state).toBe(point === 'effectIssued' ? 'unknown' : 'confirmed_applied')
      expect(readFileSync(marker, 'utf8')).toBe('issued-once')
    }
    engine.tick()
    await dispatcher.stop()
    expect(f.store.db.prepare('SELECT count(*) AS count FROM network_effect_attempts').get()!.count).toBe(count)
    const projected = f.store.db.prepare('SELECT state,count FROM network_queue_counts WHERE network_id=? AND count>0 ORDER BY state').all(f.id)
    expect(projected).toEqual(f.store.db.prepare('SELECT state,count(*) AS count FROM network_deliveries WHERE network_id=? GROUP BY state ORDER BY state').all(f.id))
    for (const podId of [f.source, f.consumer, f.downstream]) expect(f.store.checkpoint(podId)).toEqual({ revision: 0, body: {} })
  }
  finally { await engine.stop(); await dispatcher.stop() }
})

it('prunes completed traces while retaining control state, acceptance markers and unresolved evidence', async () => {
  const f = fixture()
  const authority = f.engine.invocations.reserve(f.id, f.source, 0, 'manual')!
  await f.engine.invocations.finish(authority, 'completed', 'Synthetic completed source', null, [], [{ channel: 'test.input', key: 'item', sourceItemId: 'item', sourceVersion: 'v1', payload: { subject: 'Synthetic' } }])
  for (const kind of ['network-mail-read', 'environment', 'log', 'operation', 'emission-explanation', 'infrastructure']) f.store.db.prepare('INSERT INTO network_trace_events(network_id,run_id,kind,body,created_at) VALUES(?,?,?,?,?)').run(f.id, authority.runId, kind, '{}', Date.now() - 8 * 86400000)
  f.store.db.prepare('UPDATE network_trace_events SET created_at=?').run(Date.now() - 8 * 86400000)
  f.store.db.prepare('INSERT INTO network_trace_events(network_id,kind,body,created_at) VALUES(?,?,?,1)').run(f.id, 'owner-effect-reconciled', '{"retain":"owner evidence"}')
  expect(pruneNetworkTraces(f.store, Date.now())).toBeGreaterThan(0)
  expect(f.store.db.prepare('SELECT settlement_receipt FROM network_invocation_controls WHERE run_id=?').get(authority.runId)!.settlement_receipt).toContain('Synthetic completed source')
  expect(f.store.db.prepare('SELECT count(*) AS count FROM network_event_identities').get()!.count).toBe(1)
  expect(f.store.db.prepare('SELECT state FROM network_deliveries').get()!.state).toBe('pending')
  expect(f.store.db.prepare('SELECT body FROM network_trace_events').get()!.body).toBe('{"retain":"owner evidence"}')
})

it('does not replay a consumed source retry from its original failed invocation', async () => {
  const f = fixture(); const invocations = f.engine.invocations
  const first = invocations.reserve(f.id, f.source, 0, 'manual')!
  await invocations.finish(first, 'failed', 'Synthetic data failure', 'Synthetic data failure', [], [])
  const recovery = new NetworkRecovery(f.store, '/unused')
  await recovery.inspect(f.id, first.runId, 1, () => {})
  const pins = { fingerprint: 'a'.repeat(64), resourceEpoch: 0, assignmentRevision: 1, scriptHash: f.store.getPod(f.source).activeScript! }
  recovery.requeue(f.id, first.runId, 1, pins, () => {})
  const second = invocations.reserve(f.id, f.source, 0, 'manual')!
  await invocations.finish(second, 'failed', 'Synthetic data failure', 'Synthetic data failure', [], [])
  await recovery.inspect(f.id, first.runId, 2, () => {})
  expect(() => recovery.requeue(f.id, first.runId, 2, pins, () => {})).toThrow('already consumed')
  expect(f.store.db.prepare('SELECT attempt FROM network_invocation_controls WHERE run_id=?').get(second.runId)!.attempt).toBe(2)
})

it.each([1, 2, 4, 8])('admits every backlogged production domain with %i global slots', async (concurrency) => {
  const f = networkFixture()
  const { standalone, id } = f.store.transaction(() => {
    const standalone = Array.from({ length: 8 }, () => f.pod('Standalone', { takes: [], gives: [], summary: 'Synthetic standalone' }, async () => {}))
    const channels = Array.from({ length: 8 }, (_, index) => `test.input${index}`)
    const sources = channels.map(channel => f.pod('Network', { takes: [], gives: [channel], summary: 'Synthetic source' }, async () => {}))
    const consumer = f.pod('Network consumer', { takes: channels, gives: [], summary: 'Synthetic consumer' }, async () => {})
    const id = f.create([...sources.map(podId => ({ podId, source: { schedule: { kind: 'interval' as const, seconds: 60 } }, serialCase: false })), { podId: consumer, source: null, serialCase: false }], channels)
    return { standalone, id }
  })
  f.engine.execute({ type: 'activate', id, revision: 1 })
  f.store.db.prepare('UPDATE network_source_clocks SET next_at=0').run()
  f.store.db.prepare('UPDATE settings SET concurrency=? WHERE id=1').run(concurrency)
  const scheduler = new Scheduler(f.store, f.dispatcher, Date.now, false)
  const networks = new NetworkEngine(f.store, f.dispatcher, f.resources, '/unused', () => f.owner, false)
  for (const podId of standalone) scheduler.requestManual(podId)
  const admissions: { domain: number, delayMs: number }[] = []
  let readyAt = performance.now()
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, input) => {
    admissions.push({ domain: input.network ? 1 : 0, delayMs: performance.now() - readyAt })
    return { status: 'completed', summary: 'Synthetic fair dispatch', completedInputIds: input.eventIds, gapIds: [] }
  })
  try {
    for (let turn = 0; turn < 3; turn++) {
      readyAt = performance.now()
      scheduleDomains(f.store, [() => scheduler.tick(), () => networks.tick()])
      expect(Number(f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count)).toBeLessThanOrEqual(concurrency)
      await expect.poll(() => f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0)
    }
    expect(new Set(admissions.map(item => item.domain))).toEqual(new Set([0, 1]))
    expect(Math.max(...admissions.map(item => item.delayMs))).toBeLessThan(2000)
    console.info(JSON.stringify({ measurement: 'production-domain-admission', concurrency, admissions, processMocked: true }))
  }
  finally { await networks.stop(); await f.dispatcher.stop() }
})

it('pauses quota-saturated intake without committing staged progress and resumes only after explicit capacity review', async () => {
  const f = fixture()
  const authority = f.engine.invocations.reserve(f.id, f.source, 0, 'manual')!
  f.engine.invocations.stageProgress(authority, { expectedRevision: 0, checkpoint: { cursor: 'must-not-advance' }, sources: [], claims: [] })
  const pageSize = Number(f.store.db.prepare('PRAGMA page_size').get()!.page_size)
  const filler = JSON.stringify({ synthetic: 'q'.repeat(1024 * 1024) })
  while (Number(f.store.db.prepare('PRAGMA page_count').get()!.page_count) * pageSize < 192 * 1024 * 1024) {
    f.store.db.prepare('INSERT INTO network_trace_events(network_id,kind,body,created_at) VALUES(?,?,?,?)').run(f.id, 'isolated-quota-fixture', filler, Date.now())
  }
  try {
    const error = await f.engine.invocations.finish(authority, 'completed', 'Synthetic quota boundary', null, [], [{ channel: 'test.input', key: 'quota', sourceItemId: 'quota', sourceVersion: 'v1', payload: { subject: 'Synthetic' } }]).catch(failure => failure)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain('192 MiB')
    f.engine.invocations.recordConflict(authority, error)
    await f.engine.invocations.finish(authority, 'failed', 'Intake paused by quota', error.message, [], [])
    expect(f.engine.view().networks[0]).toMatchObject({ state: 'paused', health: { intakeError: expect.stringContaining('192 MiB'), lastFailure: { kind: 'quota' } } })
    expect(f.store.db.prepare('SELECT revision,body FROM network_checkpoints WHERE pod_id=?').get(f.source)).toEqual({ revision: 0, body: '{}' })
    expect(f.store.db.prepare('SELECT count(*) AS count FROM network_event_identities').get()!.count).toBe(0)
    expect(() => f.engine.execute({ type: 'activate', id: f.id, revision: 1 })).toThrow('192 MiB')
    f.store.db.prepare('DELETE FROM network_trace_events WHERE kind=?').run('isolated-quota-fixture')
    expect(f.engine.view().networks[0]!.state).toBe('paused')
    f.engine.execute({ type: 'activate', id: f.id, revision: 1 })
    expect(f.engine.view().networks[0]).toMatchObject({ state: 'active', health: { intakeError: null } })
  }
  finally { await f.engine.stop(); await f.dispatcher.stop() }
}, 30000)

it('retains same-boot stop proof after pre-launch authority changes and permits immediate inspection', async () => {
  const f = fixture()
  const authority = f.engine.invocations.reserve(f.id, f.source, 0, 'manual')!
  f.store.db.prepare('INSERT INTO resource_epochs VALUES(?,1) ON CONFLICT(pod_id) DO UPDATE SET epoch=epoch+1').run(f.source)
  await f.engine.invocations.failClosed(authority, new Error('Synthetic pre-launch resource change'))
  const invocation = f.store.db.prepare('SELECT generation,state FROM network_invocations WHERE run_id=?').get(authority.runId)!
  expect(invocation.state).toBe('interrupted')
  await f.engine.recover({ type: 'inspect', id: f.id, revision: 1, runId: authority.runId, generation: invocation.generation })
  expect(f.store.db.prepare('SELECT 1 FROM run_leases WHERE run_id=?').get(authority.runId)).toBeUndefined()
  expect(f.store.db.prepare('SELECT state FROM network_invocations WHERE run_id=?').get(authority.runId)!.state).toBe('blocked')
  expect(f.store.db.prepare('SELECT revision FROM network_checkpoints WHERE pod_id=?').get(f.source)!.revision).toBe(0)
})

it('requires a generation-bound owner decision to discard a conflicting emission while retaining original acceptance', async () => {
  const f = fixture(); const invocations = f.engine.invocations
  const original = invocations.reserve(f.id, f.source, 0, 'manual')!
  const emission = { channel: 'test.input', key: 'item', sourceItemId: 'item', sourceVersion: 'v1', payload: { subject: 'Original' } }
  await invocations.finish(original, 'completed', 'Original accepted', null, [], [emission])
  const authority = invocations.reserve(f.id, f.source, 0, 'manual')!
  let conflict: unknown
  try { invocations.events.accept(authority, { ...emission, payload: { subject: 'Conflicting' } }) }
  catch (failure) { conflict = failure }
  invocations.recordConflict(authority, conflict)
  await invocations.finish(authority, 'failed', 'Conflict awaits review', 'Synthetic identity conflict', [], [])
  const detail = JSON.parse(f.store.db.prepare('SELECT body FROM network_trace_events WHERE run_id=? AND kind=?').get(authority.runId, 'source-identity-conflict-review')!.body as string)
  const command = { type: 'resolveConflict' as const, id: f.id, revision: 1, runId: authority.runId, generation: 1, identityHash: detail.identityHash as string, decision: 'retainOriginal' as const, evidence: 'Synthetic owner confirms original event and rejects conflicting batch' }
  await expect(f.engine.recover({ ...command, identityHash: '0'.repeat(64) })).rejects.toThrow('evidence changed')
  expect(() => invocations.reserve(f.id, f.source, 0, 'manual')).toThrow('identity conflict')
  const manifest = f.store.db.prepare('SELECT manifest FROM network_invocations WHERE run_id=?').get(authority.runId)!.manifest as string
  f.store.db.prepare('UPDATE network_invocations SET manifest=? WHERE run_id=?').run(JSON.stringify({ ...JSON.parse(manifest), inputClaims: [{ id: 'changed-input' }] }), authority.runId)
  await expect(f.engine.recover(command)).rejects.toThrow('original failed input batch changed')
  expect(f.store.db.prepare('SELECT review_required,resolved_receipt FROM network_invocation_controls WHERE run_id=?').get(authority.runId)).toEqual({ review_required: 1, resolved_receipt: null })
  f.store.db.prepare('UPDATE network_invocations SET manifest=? WHERE run_id=?').run(manifest, authority.runId)
  await f.engine.recover(command)
  await expect(f.engine.recover(command)).rejects.toThrow('state changed')
  expect(f.store.db.prepare('SELECT payload FROM network_events').get()!.payload).toContain('Original')
  expect(f.store.db.prepare('SELECT count(*) AS count FROM network_event_identities').get()!.count).toBe(1)
  expect(f.store.db.prepare('SELECT review_required,resolved_receipt FROM network_invocation_controls WHERE run_id=?').get(authority.runId)).toMatchObject({ review_required: 0, resolved_receipt: expect.any(String) })
  const receipt = JSON.parse(f.store.db.prepare('SELECT body FROM network_trace_events WHERE run_id=? AND kind=?').get(authority.runId, 'owner-identity-conflict-resolved')!.body as string)
  expect(receipt).toMatchObject({ decision: 'retainOriginal', originalAcceptanceRetained: true, originalEventId: detail.eventId })
  const next = invocations.reserve(f.id, f.source, 0, 'manual')!
  expect(next).not.toBeNull()
  await invocations.finish(next, 'completed', 'Future intake allowed', null, [], [])
})

it('requires explicit batch disposal when conflicting consumer emissions rolled back their original acceptance', async () => {
  const f = fixture(); const invocations = f.engine.invocations
  const source = invocations.reserve(f.id, f.source, 0, 'manual')!
  await invocations.finish(source, 'completed', 'Synthetic source', null, [], [{ channel: 'test.input', key: 'item', sourceItemId: 'item', sourceVersion: 'v1', payload: { subject: 'Input' } }])
  const consumer = invocations.reserve(f.id, f.consumer, 0, 'event')!
  const input = invocations.input(consumer).items[0]!
  invocations.stageProgress(consumer, { expectedRevision: 0, checkpoint: { processed: true }, sources: [], claims: [] })
  const emission = { channel: 'test.result', key: 'result', payload: { subject: 'Original' } }
  const conflict = await invocations.finish(consumer, 'completed', 'Conflicting batch', null, [input.eventId], [emission, { ...emission, payload: { subject: 'Conflict' } }]).catch(failure => failure)
  expect(conflict).toBeInstanceOf(Error)
  invocations.recordConflict(consumer, conflict)
  await invocations.finish(consumer, 'failed', 'Batch awaits owner review', conflict.message, [], [])
  const detail = JSON.parse(f.store.db.prepare('SELECT body FROM network_trace_events WHERE run_id=? AND kind=?').get(consumer.runId, 'source-identity-conflict-review')!.body as string)
  const command = { type: 'resolveConflict' as const, id: f.id, revision: 1, runId: consumer.runId, generation: 1, identityHash: detail.identityHash as string, evidence: 'Synthetic owner rejects the entire rolled-back batch' }
  await expect(f.engine.recover({ ...command, decision: 'retainOriginal' })).rejects.toThrow('Original acceptance rolled back')
  expect(f.store.db.prepare('SELECT state FROM network_deliveries WHERE run_id=?').get(consumer.runId)!.state).toBe('blocked')
  await f.engine.recover({ ...command, decision: 'discardBatch' })
  expect(f.store.db.prepare('SELECT state FROM network_deliveries WHERE run_id=?').get(consumer.runId)!.state).toBe('discarded')
  expect(f.store.db.prepare('SELECT count(*) AS count FROM network_events').get()!.count).toBe(1)
  expect(f.store.db.prepare('SELECT count(*) AS count FROM network_event_identities').get()!.count).toBe(1)
  expect(f.store.db.prepare('SELECT revision FROM network_checkpoints WHERE pod_id=?').get(f.consumer)!.revision).toBe(0)
  expect(f.store.db.prepare('SELECT review_required,retry_consumed_at,resolved_receipt FROM network_invocation_controls WHERE run_id=?').get(consumer.runId)).toMatchObject({ review_required: 0, retry_consumed_at: null, resolved_receipt: expect.any(String) })
  const receipt = JSON.parse(f.store.db.prepare('SELECT body FROM network_trace_events WHERE run_id=? AND kind=?').get(consumer.runId, 'owner-identity-conflict-resolved')!.body as string)
  expect(receipt).toMatchObject({ decision: 'discardBatch', originalAcceptanceRetained: false, originalEventId: null, conflictingBatchRetryPermitted: false })
  await expect(f.engine.recover({ ...command, decision: 'discardBatch' })).rejects.toThrow('state changed')
})

it('bounds previews and expires unused authority while retaining previews referenced by unresolved invocations', () => {
  const f = fixture()
  const previews = Array.from({ length: 64 }, () => f.engine.execute({ type: 'preview', id: f.id, revision: 1, podIds: [f.source], pausedPodIds: [], budget: 1 }).preview!)
  expect(() => f.engine.execute({ type: 'preview', id: f.id, revision: 1, podIds: [f.source], pausedPodIds: [], budget: 1 })).toThrow('64 retained')
  f.store.db.prepare('UPDATE network_process_previews SET consumed_at=?,state=? WHERE id=?').run(Date.now(), 'running', previews[0]!.id)
  const unresolved = f.engine.invocations.reserve(f.id, f.source, 0, 'manual', false, previews[0]!.id)!
  f.store.db.prepare('UPDATE network_process_previews SET expires_at=?').run(Date.now() - 1)
  pruneNetworkTraces(f.store, Date.now())
  expect(f.store.db.prepare('SELECT id FROM network_process_previews').all()).toEqual([{ id: previews[0]!.id }])
  expect(f.store.db.prepare('SELECT 1 FROM run_leases WHERE run_id=?').get(unresolved.runId)).toBeDefined()
  expect(f.engine.execute({ type: 'preview', id: f.id, revision: 1, podIds: [f.source], pausedPodIds: [], budget: 1 }).preview).toBeDefined()
})

it('reclaims diagnostic and preview storage after explicit failure disposal while keeping acceptance and owner evidence', async () => {
  const f = fixture()
  const source = f.engine.invocations.reserve(f.id, f.source, 0, 'manual')!
  await f.engine.invocations.finish(source, 'completed', 'Synthetic source', null, [], [{ channel: 'test.input', key: 'item', sourceItemId: 'item', sourceVersion: 'v1', payload: { subject: 'Retained source' } }])
  f.behaviours.set(f.consumer, async () => { throw new Error('Synthetic permanent consumer failure') })
  f.process(f.id, [f.consumer], [], 1)
  await expect.poll(() => f.store.db.prepare('SELECT state FROM network_invocations WHERE pod_id=?').get(f.consumer)?.state).toBe('blocked')
  const invocation = f.store.db.prepare('SELECT run_id,generation FROM network_invocations WHERE pod_id=?').get(f.consumer)!
  const previewId = f.store.db.prepare('SELECT process_preview_id FROM network_invocation_controls WHERE run_id=?').get(invocation.run_id!)!.process_preview_id
  try {
    await f.engine.recover({ type: 'discardFailure', id: f.id, revision: 1, runId: invocation.run_id, generation: invocation.generation, evidence: 'Synthetic owner confirms this failed delivery should be discarded' })
    expect(f.store.db.prepare('SELECT state,review_receipt FROM network_deliveries').get()).toMatchObject({ state: 'discarded', review_receipt: expect.stringContaining('checkpointRetained') })
    expect(f.store.db.prepare('SELECT resolved_receipt FROM network_invocation_controls WHERE run_id=?').get(invocation.run_id!)!.resolved_receipt).toContain(previewId as string)
    f.store.db.prepare('UPDATE network_trace_events SET created_at=?').run(Date.now() - 8 * 86400000)
    f.store.db.prepare('UPDATE network_process_previews SET expires_at=?').run(Date.now() - 1)
    expect(pruneNetworkTraces(f.store, Date.now())).toBeGreaterThan(0)
    expect(f.store.db.prepare('SELECT * FROM network_process_previews').all()).toEqual([])
    expect(f.store.db.prepare('SELECT process_preview_id FROM network_invocation_controls WHERE run_id=?').get(invocation.run_id!)!.process_preview_id).toBeNull()
    expect(f.store.db.prepare('SELECT count(*) AS count FROM network_event_identities').get()!.count).toBe(1)
    expect(f.store.db.prepare('SELECT payload FROM network_events').get()!.payload).toContain('Retained source')
    expect(f.store.db.prepare('SELECT 1 FROM network_trace_events WHERE kind=?').get('owner-failed-invocation-discarded')).toBeDefined()
    expect(f.store.db.prepare('SELECT revision FROM network_checkpoints WHERE pod_id=?').get(f.consumer)!.revision).toBe(0)
    expect(f.engine.execute({ type: 'preview', id: f.id, revision: 1, podIds: [f.consumer], pausedPodIds: [], budget: 1 }).preview).toBeDefined()
  }
  finally { await f.engine.stop(); await f.dispatcher.stop() }
})

it('refuses disposal of an uncertain effect until owner reconciliation and retains every effect receipt', async () => {
  const f = fixture(); const source = f.engine.invocations.reserve(f.id, f.source, 0, 'manual')!
  await f.engine.invocations.finish(source, 'completed', 'Synthetic source', null, [], [{ channel: 'test.input', key: 'item', sourceItemId: 'item', sourceVersion: 'v1', payload: { subject: 'Synthetic' } }])
  const consumer = f.engine.invocations.reserve(f.id, f.consumer, 0, 'event')!
  const input = f.engine.invocations.input(consumer).items[0]!
  const key = 'a'.repeat(64)
  f.store.transaction(() => {
    f.store.db.prepare('INSERT INTO network_effect_attempts VALUES(?,1,?,?,1,?,?,?,1,?)').run(key, consumer.runId, input.caseId, 'b'.repeat(64), 'c'.repeat(64), 'unknown', f.id)
    f.store.db.prepare('INSERT INTO network_effect_receipts VALUES(?,1,1,?,?,1)').run(key, 'unknown', '{"synthetic":true}')
  })
  await f.engine.invocations.finish(consumer, 'failed', 'Unknown synthetic outcome', 'Synthetic uncertainty', [], [])
  const command = { type: 'discardFailure' as const, id: f.id, revision: 1, runId: consumer.runId, generation: 1, evidence: 'Synthetic owner disposal review' }
  await expect(f.engine.recover(command)).rejects.toThrow('reconciliation')
  expect(f.store.db.prepare('SELECT state FROM network_deliveries').get()!.state).toBe('unknown')
  await f.engine.recover({ type: 'reconcileEffect', id: f.id, revision: 1, runId: consumer.runId, generation: 1, key, attempt: 1, sequence: 1, outcome: 'confirmed_not_applied', evidence: 'Synthetic owner confirms no external application' })
  await f.engine.recover(command)
  expect(f.store.db.prepare('SELECT state FROM network_deliveries').get()!.state).toBe('discarded')
  expect(f.store.db.prepare('SELECT outcome FROM network_effect_receipts ORDER BY sequence').all()).toEqual([{ outcome: 'unknown' }, { outcome: 'confirmed_not_applied' }])
  expect(f.store.db.prepare('SELECT count(*) AS count FROM network_effect_attempts').get()!.count).toBe(1)
})

it('keeps an in-memory processing batch when the pause transaction rolls back', async () => {
  const f = fixture()
  f.process(f.id, [f.source], [], 1)
  f.store.db.exec('CREATE TRIGGER reject_pause_receipt BEFORE INSERT ON network_trace_events WHEN NEW.kind=\'network-paused\' BEGIN SELECT RAISE(ABORT,\'synthetic pause receipt failure\'); END')
  expect(() => f.engine.execute({ type: 'pause', id: f.id, revision: 1 })).toThrow('synthetic pause receipt failure')
  expect(f.store.db.prepare('SELECT state FROM network_process_previews').get()!.state).toBe('running')
  expect(f.engine.view().networks[0]!.state).toBe('active')
  f.store.db.exec('DROP TRIGGER reject_pause_receipt')
  f.engine.tick()
  await expect.poll(() => f.started).toContain(f.source)
  await f.engine.stop(); await f.dispatcher.stop()
})
