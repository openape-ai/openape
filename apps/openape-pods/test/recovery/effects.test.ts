// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PodDatabase } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { RunStore } from '../../src/worker/runs/store'
import { RunDispatcher } from '../../src/worker/runs/dispatcher'
import { installExample } from '../../src/worker/runs/examples'
import { Recovery } from '../../src/worker/recovery/reconcile'
import { Scheduler } from '../../src/worker/scheduling/scheduler'
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
describe('fencing and effect reconciliation', () => {
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
    if (first.execute) { externalEffects++; f.ledger.complete(f.pod.id, 'effect-1', { receipt: 'synthetic-receipt' }) }
    expect(f.ledger.begin(f.pod.id, f.run.id, 'effect-1', 'fixture.write', { value: 1 })).toEqual({ execute: false, result: { receipt: 'synthetic-receipt' } })
    expect(externalEffects).toBe(1)
    expect(() => f.ledger.begin(f.pod.id, f.run.id, 'effect-1', 'fixture.write', { value: 2 })).toThrow('conflicting')
  })
  it('blocks explicit retry while an external outcome is unknown', async () => {
    const f = fixture(); f.ledger.begin(f.pod.id, f.run.id, 'effect-1', 'fixture.write', {})
    f.runs.finish(f.run.id, 'failed', 'Synthetic interruption', 'No receipt')
    const starts: string[] = []
    const scheduler = new Scheduler(f.store, { start: (id) => { starts.push(id); return 'unused' } })
    const recovery = new Recovery(f.store, f.resources, scheduler, '/unused')
    await expect(recovery.retry(f.pod.id, f.run.id)).rejects.toThrow('unknown outcome')
    expect(f.runs.get(f.run.id).recovery?.state).toBe('needsReview')
    expect(starts).toEqual([])
  })
  it('keeps an unknown result blocked until a trusted reconciliation establishes the outcome', () => {
    const f = fixture(); f.ledger.begin(f.pod.id, f.run.id, 'effect-1', 'fixture.write', {})
    const externalReceipt = { applied: true as const, result: { id: 'synthetic-once' } }
    new RunDispatcher(f.store, f.resources, { helper: '/unused', executable: '/unused', entry: '/unused', runtimeDirectories: [], environment: {}, binary: '/unused', catalog: '/unused', manifest: '/unused', sdkHost: '/unused' })
    expect(f.store.db.prepare('SELECT state FROM effect_ledger').get()!.state).toBe('unknown')
    expect(() => f.ledger.complete(f.pod.id, 'effect-1', externalReceipt.result)).toThrow('not awaiting')
    f.ledger.reconcile(f.pod.id, 'effect-1', externalReceipt)
    expect(f.store.db.prepare('SELECT state,result FROM effect_ledger').get()).toMatchObject({ state: 'completed', result: JSON.stringify(externalReceipt.result) })
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
