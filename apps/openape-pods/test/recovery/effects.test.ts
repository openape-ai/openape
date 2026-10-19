import { randomUUID } from 'node:crypto'
import { executeRecordedProgram } from '../../src/main/programs/effect-execution'
import { recordProgramExecution } from '../../src/worker/runs/program-execution'
// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RunRetention } from '../../src/worker/data/run-retention'
import { PodDatabase } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { RunStore } from '../../src/worker/runs/store'
import { RunDispatcher } from '../../src/worker/runs/dispatcher'
import { installExample } from '../../src/worker/runs/examples'
import { EffectLedger } from '../../src/worker/recovery/effects'

const stores: PodDatabase[] = []; const roots: string[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pods-effects-')); roots.push(root)
  const store = new PodDatabase(root); stores.push(store); const resources = new ResourceRegistry(store, () => {})
  const pod = store.createPod({ name: 'Effect fixture' }); installExample(store, resources, pod.id, 'deterministic', 'a'.repeat(64))
  const runs = new RunStore(store); const run = runs.reserve(pod.id, store.getPod(pod.id).activeScript!, 0).run
  return { store, resources, pod, run, runs, ledger: new EffectLedger(store) }
}
describe('fencing and effect receipts', () => {
  it('fences previous run authority immediately on worker startup', () => {
    const f = fixture()
    f.store.commitProgress({ podId: f.pod.id, expectedRevision: 0, checkpoint: { committed: true }, sources: [], claims: [] })
    new RunDispatcher(f.store, f.resources, { helper: '/unused', executable: '/unused', entry: '/unused', runtimeDirectories: [], environment: {}, binary: '/unused', catalog: '/unused', manifest: '/unused', sdkHost: '/unused' })
    expect(() => f.runs.assertLease(f.run.id)).toThrow('no longer owned')
    expect(() => f.runs.registerDomain(f.run.id, join(f.store.root, 'runs', f.run.id, 'domain-00000000-0000-4000-8000-000000000001.record'), process.pid)).toThrow('fenced')
    expect(f.runs.get(f.run.id)).toMatchObject({ state: 'interrupted', checkpointRevision: 1 })
  })
  it('returns a completed idempotent result and rejects conflicting input', () => {
    const f = fixture(); let externalEffects = 0
    const first = f.ledger.begin(f.pod.id, f.run.id, 'effect-1', 'fixture.write', { value: 1 })
    if (first.execute) { externalEffects++; f.ledger.complete(f.pod.id, f.run.id, 'effect-1', { receipt: 'synthetic-receipt' }) }
    expect(f.ledger.begin(f.pod.id, f.run.id, 'effect-1', 'fixture.write', { value: 1 })).toEqual({ execute: false, result: { receipt: 'synthetic-receipt' } })
    expect(externalEffects).toBe(1)
    expect(() => f.ledger.begin(f.pod.id, f.run.id, 'effect-1', 'fixture.write', { value: 2 })).toThrow('conflicting')
  })
  it('keeps an unknown result as a log until a later run sends its key again', () => {
    const f = fixture(); f.ledger.begin(f.pod.id, f.run.id, 'effect-1', 'fixture.write', {})
    new RunDispatcher(f.store, f.resources, { helper: '/unused', executable: '/unused', entry: '/unused', runtimeDirectories: [], environment: {}, binary: '/unused', catalog: '/unused', manifest: '/unused', sdkHost: '/unused' })
    expect(f.store.db.prepare('SELECT state FROM effect_ledger').get()!.state).toBe('unknown')
    expect(() => f.ledger.complete(f.pod.id, f.run.id, 'effect-1', { id: 'synthetic-once' })).toThrow('not awaiting')
    f.store.db.prepare('DELETE FROM run_leases').run()
    const next = f.runs.reserve(f.pod.id, f.store.getPod(f.pod.id).activeScript!, 0).run
    expect(f.ledger.begin(f.pod.id, next.id, 'effect-1', 'fixture.write', {})).toEqual({ execute: true })
    f.ledger.complete(f.pod.id, next.id, 'effect-1', { id: 'synthetic-once' })
    expect(f.store.db.prepare('SELECT state,run_id,result FROM effect_ledger').get()).toMatchObject({ state: 'completed', run_id: next.id, result: JSON.stringify({ id: 'synthetic-once' }) })
  })
  it('refuses a key an earlier run is still sending and lets only the owning run settle it', () => {
    const f = fixture()
    expect(f.ledger.begin(f.pod.id, f.run.id, 'effect-1', 'fixture.write', {})).toEqual({ execute: true })
    // The earlier run ended within this worker while its request is still in flight.
    f.runs.finish(f.run.id, 'failed', 'Stopped', null); f.store.db.prepare('DELETE FROM run_leases').run()
    const next = f.runs.reserve(f.pod.id, f.store.getPod(f.pod.id).activeScript!, 0).run
    expect(() => f.ledger.begin(f.pod.id, next.id, 'effect-1', 'fixture.write', {})).toThrow('still being sent by an earlier run')
    expect(() => f.ledger.complete(f.pod.id, next.id, 'effect-1', { id: 'other' })).toThrow('not awaiting')
    expect(() => f.ledger.markUnknown(f.pod.id, next.id, 'effect-1')).toThrow('not awaiting')
    f.ledger.markUnknown(f.pod.id, f.run.id, 'effect-1')
    expect(f.ledger.begin(f.pod.id, next.id, 'effect-1', 'fixture.write', {})).toEqual({ execute: true })
  })
})

it('keeps the current approval visible after many earlier grants and removes it after cancellation', () => {
  const f = fixture()
  for (let index = 0; index < 40; index++) f.runs.append(f.run.id, 'approval', { grantId: `past-${index}`, issuer: 'https://id.example.test', title: 'Past approval', state: 'approved' })
  const pending = { grantId: 'current', issuer: 'https://id.example.test', title: 'Current approval', state: 'pending' }
  f.runs.append(f.run.id, 'approval', pending)
  f.runs.append(f.run.id, 'approval', { ...pending, openError: 'Browser did not open' })
  expect(f.runs.approvals(f.pod.id)).toHaveLength(1)
  expect(f.runs.approvals(f.pod.id)[0]).toMatchObject({ grantId: 'current', openError: 'Browser did not open' })
  f.runs.finish(f.run.id, 'cancelled', 'Cancelled', null)
  expect(f.runs.approvals(f.pod.id)).toEqual([])
})

it('retains complete approval timing when recent diagnostics exceed the visible event page', () => {
  const f = fixture()
  f.store.db.prepare('UPDATE runs SET started_at=1000 WHERE id=?').run(f.run.id)
  const grant = { grantId: 'wait', issuer: 'https://id.example.test', title: 'Permission' }
  f.runs.append(f.run.id, 'approval', { ...grant, state: 'pending' })
  f.store.db.prepare('UPDATE run_events SET at=2000 WHERE run_id=? AND type=\'approval\'').run(f.run.id)
  f.runs.append(f.run.id, 'approval', { ...grant, state: 'approved' })
  f.store.db.prepare('UPDATE run_events SET at=5000 WHERE run_id=? AND json_extract(data,\'$.state\')=\'approved\'').run(f.run.id)
  f.store.transaction(() => {
    for (let index = 0; index < 510; index++) f.runs.append(f.run.id, 'diagnostic', { text: 'Synthetic progress' })
  })
  f.runs.finish(f.run.id, 'completed', 'Synthetic', null)
  f.store.db.prepare('UPDATE runs SET finished_at=10000 WHERE id=?').run(f.run.id)
  expect(f.runs.timing(f.pod.id, f.run.id)).toEqual({ activeMs: 6000, waitingMs: 3000 })
  expect(f.runs.recentEvents(f.pod.id, f.run.id)).toHaveLength(500)
  expect(f.runs.recentEvents(f.pod.id, f.run.id).at(-1)?.type).toBe('finished')
})

it('returns the original HTTP receipt after its run and folder have been pruned', async () => {
  const f = fixture(); const retention = new RunRetention(f.store)
  const input = { url: 'https://delivery.example.test', body: 'once' }
  let deliveries = 0
  if (f.ledger.begin(f.pod.id, f.run.id, 'delivery', 'http.request', input).execute) {
    deliveries++; f.ledger.complete(f.pod.id, f.run.id, 'delivery', { status: 200, body: 'confirmed' })
  }
  f.runs.finish(f.run.id, 'completed', 'Sent', null)
  f.store.db.prepare('UPDATE runs SET started_at=0 WHERE id=?').run(f.run.id)
  for (let index = 0; index < 50; index++) {
    const run = f.runs.reserve(f.pod.id, f.store.getPod(f.pod.id).activeScript!, 0).run
    f.runs.finish(run.id, 'completed', 'Later', null)
  }
  await retention.prune()
  expect(() => f.runs.get(f.run.id)).toThrow('Run not found')
  expect(f.store.db.prepare('SELECT run_id FROM effect_ledger').get()).toEqual({ run_id: null })
  const current = f.runs.reserve(f.pod.id, f.store.getPod(f.pod.id).activeScript!, 0).run
  const replay = f.ledger.begin(f.pod.id, current.id, 'delivery', 'http.request', input)
  if (replay.execute) deliveries++
  expect(replay).toEqual({ execute: false, result: { status: 200, body: 'confirmed' } })
  expect(deliveries).toBe(1)
  expect(() => f.ledger.begin(f.pod.id, current.id, 'delivery', 'http.request', { ...input, body: 'changed' })).toThrow('conflicting')
  expect(() => f.store.db.prepare('UPDATE effect_ledger SET state=\'unknown\' WHERE effect_key=\'delivery\'').run()).toThrow('CHECK')
})

it('prunes an old run whose external input failed, since nothing retries a failed input', async () => {
  const f = fixture(); const retention = new RunRetention(f.store)
  f.store.db.prepare('INSERT INTO accepted_events(id,pod_id,source,dedupe_key,payload,accepted_at,state,run_id) VALUES(\'failed-input\',?,\'webhook\',\'k\',\'{}\',1,\'failed\',?)').run(f.pod.id, f.run.id)
  f.store.db.prepare('UPDATE run_inputs SET event_ids=\'["failed-input"]\' WHERE run_id=?').run(f.run.id)
  f.runs.finish(f.run.id, 'failed', 'Failed', 'Synthetic failure')
  f.store.db.prepare('UPDATE runs SET started_at=0 WHERE id=?').run(f.run.id)
  for (let index = 0; index < 50; index++) f.runs.finish(f.runs.reserve(f.pod.id, f.store.getPod(f.pod.id).activeScript!, 0).run.id, 'completed', 'Later', null)
  await retention.prune()
  expect(() => f.runs.get(f.run.id)).toThrow('Run not found')
  expect(f.store.db.prepare('SELECT state,run_id FROM accepted_events WHERE id=\'failed-input\'').get()).toEqual({ state: 'failed', run_id: null })
})

it('persists ape-shell write intent before acknowledgement and resends an uncertain result under its identity', async () => {
  const f = fixture()
  const operationId = randomUUID()
  const scope = { podId: f.pod.id, runId: f.run.id, epoch: 0, assignmentRevision: 1, capabilities: [] }
  const record = async (record: Parameters<typeof recordProgramExecution>[1]['record']) => { recordProgramExecution(f.store, { scope, operationId, record }) }
  let starts = 0
  await expect(executeRecordedProgram({ command: 'synthetic-secret' }, async (observer) => {
    await observer.authorized({ grantId: 'verified', write: true })
    expect(f.store.db.prepare('SELECT state FROM effect_ledger').get()?.state).toBe('intent')
    starts++
    throw new Error('Lost execution receipt')
  }, record)).rejects.toThrow('Lost execution receipt')
  expect(f.store.db.prepare('SELECT state FROM effect_ledger').get()?.state).toBe('unknown')
  expect(JSON.stringify(f.store.db.prepare('SELECT * FROM effect_ledger').all())).not.toContain('synthetic-secret')
  await executeRecordedProgram({ command: 'synthetic-secret' }, async (observer) => {
    await observer.authorized({ grantId: 'verified', write: true }); starts++; return { exitCode: 0 }
  }, record)
  expect(starts).toBe(2)
  expect(f.store.db.prepare('SELECT state FROM effect_ledger').get()?.state).toBe('completed')
  await expect(executeRecordedProgram({ command: 'synthetic-secret' }, async (observer) => {
    await observer.authorized({ grantId: 'verified', write: true }); starts++; return { exitCode: 0 }
  }, record)).rejects.toThrow('already completed')
  expect(starts).toBe(2)
})

it('drops only a private-channel not-started intent and keeps failed or completed writes non-replayable', async () => {
  for (const scenario of ['not-started', 'failed', 'completed']) {
    const f = fixture(); const operationId = randomUUID()
    const scope = { podId: f.pod.id, runId: f.run.id, epoch: 0, assignmentRevision: 1, capabilities: [] }
    const record = async (record: Parameters<typeof recordProgramExecution>[1]['record']) => { recordProgramExecution(f.store, { scope, operationId, record }) }
    const result = executeRecordedProgram({}, async (observer) => {
      await observer.authorized({ grantId: 'verified', write: true })
      if (scenario === 'not-started') { await observer.notStarted!(); throw new Error('File changed before dispatch') }
      return { exitCode: scenario === 'failed' ? 1 : 0 }
    }, record)
    if (scenario === 'not-started') { await expect(result).rejects.toThrow('before dispatch'); expect(f.store.db.prepare('SELECT * FROM effect_ledger').all()).toEqual([]) }
    else { await result; expect(f.store.db.prepare('SELECT state FROM effect_ledger').get()?.state).toBe(scenario === 'completed' ? 'completed' : 'unknown') }
  }
})
