// @vitest-environment node
import { recoverStoppedRuns, stoppedRunRecheckMs } from '../../src/worker/recovery/automatic'
import { releaseHeldWork } from '../../src/worker/recovery/release'
import { EffectLedger } from '../../src/worker/recovery/effects'
import { boundedStep } from '../../src/worker/scheduling/tick-step'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PodDatabase } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { RunStore } from '../../src/worker/runs/store'
import type { RunTrigger } from '../../src/worker/runs/store'
import { installExample } from '../../src/worker/runs/examples'
import { Scheduler } from '../../src/worker/scheduling/scheduler'
import { nextDaily, nextDue } from '../../src/worker/scheduling/clock'

const stores: PodDatabase[] = []; const roots: string[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pods-schedule-')); roots.push(root)
  const store = new PodDatabase(root); stores.push(store)
  const resources = new ResourceRegistry(store, () => {})
  const runs = new RunStore(store); const started: { podId: string, id: string, trigger: RunTrigger }[] = []
  let now = 1000
  const scheduler = new Scheduler(store, { start: (podId, trigger) => { const run = runs.reserve(podId, store.getPod(podId).activeScript!, resources.epoch(podId), trigger).run; started.push({ podId, id: run.id, trigger }); return run.id } }, () => now)
  const pod = (active = true) => { const created = store.createPod({ name: 'Synthetic' }); if (active) scheduler.lifecycle(created.id, created.revision, 'active'); installExample(store, resources, created.id, 'deterministic', 'a'.repeat(64)); return created.id }
  return { store, resources, runs, scheduler, started, pod, time: (instant: number) => { now = instant } }
}
describe('persistent scheduling and intake', () => {
  it('coalesces ten missed slots and one queued catch-up while a pod is running', () => {
    const f = fixture(); const pod = f.pod()
    f.scheduler.save(pod, 0, { kind: 'interval', seconds: 60 }, true)
    f.time(601000); f.scheduler.tick(); f.scheduler.tick()
    expect(f.started).toHaveLength(1); expect(f.scheduler.view(pod).nextAt).toBe(661000)
    f.time(721000); f.scheduler.tick(); f.time(901000); f.scheduler.tick()
    expect(f.scheduler.view(pod).pending).toBe(1)
    f.runs.finish(f.started[0]!.id, 'completed', 'Processed', null, f.started[0]!.trigger.eventIds)
    f.scheduler.tick(); expect(f.started).toHaveLength(2)
    expect(f.started[1]!.trigger.eventIds).toHaveLength(1)
  })
  it('retains every distinct input, acknowledges duplicates and commits completion once', () => {
    const f = fixture(); const pod = f.pod()
    const ids = ['A', 'B', 'C'].map(key => f.scheduler.acceptEvent(pod, 'fixture', key, { same: true }))
    expect(f.scheduler.acceptEvent(pod, 'fixture', 'A', { same: true })).toBe(ids[0])
    expect(() => f.scheduler.acceptEvent(pod, 'fixture', 'A', { changed: true })).toThrow('conflicts')
    f.scheduler.tick(); expect(f.started[0]!.trigger.eventIds).toEqual(ids)
    f.runs.finish(f.started[0]!.id, 'completed', 'Processed', null, ids)
    f.scheduler.tick(); expect(f.started).toHaveLength(1)
    expect(f.store.db.prepare('SELECT count(*) AS count FROM accepted_events WHERE state=\'processed\'').get()!.count).toBe(3)
  })
  it('admits ready pods in FIFO order and never exceeds global or per-pod leases', () => {
    const f = fixture(); const ids = [f.pod(), f.pod(), f.pod()]
    for (const [index, id] of ids.entries()) f.scheduler.acceptEvent(id, 'fixture', String(index), {})
    f.scheduler.tick(); expect(f.started.map(run => run.podId)).toEqual(ids.slice(0, 2))
    f.scheduler.acceptEvent(ids[0]!, 'fixture', 'later', {})
    f.scheduler.tick(); expect(f.started).toHaveLength(2)
    f.runs.finish(f.started[0]!.id, 'completed', 'Processed', null, f.started[0]!.trigger.eventIds)
    f.scheduler.tick(); expect(f.started[2]!.podId).toBe(ids[2])
    expect(f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(2)
    f.scheduler.concurrency(1); f.scheduler.tick(); expect(f.started).toHaveLength(3)
  })
  it('includes accepted input in an explicitly requested run while keeping automatic execution paused', () => {
    const f = fixture(); const pod = f.pod(false)
    const input = f.scheduler.acceptEvent(pod, 'fixture', 'paused-input', {})
    f.scheduler.tick(); expect(f.started).toHaveLength(0)
    f.scheduler.requestManual(pod)
    expect(f.started[0]!.trigger.eventIds).toContain(input)
    expect(f.store.getPod(pod).lifecycle).toBe('paused')
  })
  it('keeps paused schedules inert and catches up once after explicit resume', () => {
    const f = fixture(); const pod = f.pod(false)
    f.scheduler.save(pod, 0, { kind: 'interval', seconds: 60 }, true)
    f.time(601000); f.scheduler.tick(); expect(f.started).toHaveLength(0)
    f.scheduler.lifecycle(pod, 1, 'active'); f.scheduler.tick(); expect(f.started).toHaveLength(1)
    f.time(1000); f.scheduler.tick(); expect(f.started).toHaveLength(1)
    expect(f.scheduler.view(pod).nextAt).toBe(661000)
  })
  it('defaults schedules off, preserves accepted input across restart and rejects queue overflow', () => {
    const f = fixture(); const pod = f.pod(false)
    expect(f.scheduler.view(pod)).toMatchObject({ enabled: false, spec: null })
    const accepted = f.scheduler.acceptEvent(pod, 'fixture', 'before-ack', {})
    f.store.close(); stores.splice(stores.indexOf(f.store), 1)
    const reopened = new PodDatabase(f.store.root); stores.push(reopened)
    const next = new Scheduler(reopened, { start: () => { throw new Error('Paused') } })
    expect(next.acceptEvent(pod, 'fixture', 'before-ack', {})).toBe(accepted)
    // Seed capacity together; the restart above independently verifies durable acceptance.
    reopened.transaction(() => {
      for (let i = 1; i < 1000; i++) next.acceptEvent(pod, 'fixture', String(i), {})
    })
    expect(() => next.acceptEvent(pod, 'fixture', 'overflow', {})).toThrow('full')
    expect(next.acceptEvent(pod, 'fixture', 'before-ack', {})).toBe(accepted)
  })
  it('retries failed inputs before new work and retains invalid dispatch as a failed input', () => {
    const f = fixture(); const pod = f.pod()
    f.scheduler.acceptEvent(pod, 'fixture', 'A', {}); f.scheduler.tick()
    f.runs.finish(f.started[0]!.id, 'failed', 'Failed', 'Synthetic failure')
    f.scheduler.acceptEvent(pod, 'fixture', 'B', {}); f.scheduler.tick()
    expect(f.started).toHaveLength(1); expect(f.scheduler.view(pod)).toMatchObject({ blocked: 0, pending: 2, retry: { attempt: 1 } })
    expect(f.scheduler.view(pod).blockedSince).toBeNull()
    const other = f.store.createPod({ name: 'Unconfigured' })
    f.scheduler.requestManual(other.id)
    expect(f.scheduler.view(other.id).failed).toBe(1)
  })
  it('persists event claims atomically with the run lease and rejects foreign event binding', () => {
    const f = fixture(); const first = f.pod(); const other = f.pod()
    const foreign = f.scheduler.acceptEvent(other, 'fixture', 'foreign', {})
    expect(() => f.runs.reserve(first, f.store.getPod(first).activeScript!, 0, { reason: 'event', eventIds: [foreign] })).toThrow('available')
    expect(f.runs.list(first)).toHaveLength(0)
    expect(f.store.db.prepare('SELECT state FROM accepted_events WHERE id=?').get(foreign)!.state).toBe('pending')
  })
})
describe('wall clock schedules', () => {
  it('moves a missing spring clock time forward and chooses one fall clock occurrence', () => {
    const spec = { kind: 'daily' as const, time: '02:30', timezone: 'Europe/Vienna' }
    expect(new Date(nextDaily(spec, Date.parse('2026-03-28T23:00:00Z'))).toISOString()).toBe('2026-03-29T01:00:00.000Z')
    expect(new Date(nextDaily(spec, Date.parse('2026-10-24T22:00:00Z'))).toISOString()).toBe('2026-10-25T00:30:00.000Z')
    expect(new Date(nextDaily(spec, Date.parse('2026-10-25T00:45:00Z'))).toISOString()).toBe('2026-10-26T01:30:00.000Z')
  })
  it('retains interval phase across a forward jump and waits after a backward jump', () => {
    expect(nextDue({ kind: 'interval', seconds: 60 }, 61000, 601000)).toBe(661000)
    expect(nextDue({ kind: 'interval', seconds: 60 }, 61000, 1000)).toBe(61000)
  })
})
it('starts exactly the reviewed script or rejects without adding a delayed manual request', () => {
  const f = fixture(); const pod = f.pod(false); const hash = f.store.getPod(pod).activeScript!
  expect(() => f.scheduler.requestManual(pod, '0'.repeat(64))).toThrow('Script changed')
  expect(f.scheduler.view(pod).pending).toBe(0)
  f.scheduler.requestManual(pod, hash); expect(f.started).toHaveLength(1)
  expect(() => f.scheduler.requestManual(pod, hash)).toThrow('execution slot')
  f.runs.finish(f.started[0]!.id, 'completed', 'Done', null, f.started[0]!.trigger.eventIds)
  f.scheduler.acceptEvent(pod, 'fixture', 'pending', {})
  expect(() => f.scheduler.requestManual(pod, hash)).toThrow('pending inputs')
  expect(f.scheduler.view(pod).pending).toBe(1)
})

it('lets earlier ready pods take their slots without queuing a reviewed script for later', () => {
  const f = fixture(); const earlier = [f.pod(), f.pod()]; const selected = f.pod(false)
  for (const podId of earlier) f.scheduler.acceptEvent(podId, 'fixture', 'earlier', {})
  expect(() => f.scheduler.requestManual(selected, f.store.getPod(selected).activeScript!)).toThrow('execution slot')
  expect(f.started.map(run => run.podId)).toEqual(earlier)
  expect(f.scheduler.view(selected).pending).toBe(0)
  for (const run of f.started) f.runs.finish(run.id, 'completed', 'Done', null, run.trigger.eventIds)
  f.scheduler.tick()
  expect(f.started.map(run => run.podId)).toEqual(earlier)
})
it('continues a scheduler tick past a step whose promise never settles and names that step', async () => {
  const expired = vi.fn()
  expect(await boundedStep(50, async () => 'done', expired)).toBe('done')
  expect(await boundedStep(20, () => new Promise<never>(() => {}), expired)).toBeUndefined()
  expect(expired).toHaveBeenCalledOnce()
  await expect(boundedStep(50, async () => { throw new Error('Storage inspection failed') }, expired)).rejects.toThrow('Storage inspection failed')
})

it('persists delayed pre-script retries, releases capacity and resumes the original inputs after restart', () => {
  const f = fixture(); const pod = f.pod()
  const input = f.scheduler.acceptEvent(pod, 'fixture', 'retry', {})
  f.scheduler.tick()
  const first = f.started[0]!
  f.runs.finish(first.id, 'failed', 'Run failed', 'Permission service temporarily unavailable', [], 0)
  const retry = f.scheduler.view(pod).retry!
  expect(f.scheduler.view(pod)).toMatchObject({ blocked: 0, pending: 1, retry: { attempt: 1 } })
  expect(f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0)
  f.time(retry.at - 1); f.scheduler.tick(); expect(f.started).toHaveLength(1)
  f.store.close(); stores.splice(stores.indexOf(f.store), 1)
  const restored = new PodDatabase(f.store.root); stores.push(restored)
  const runs = new RunStore(restored)
  const resumed = vi.fn((podId: string, trigger: RunTrigger) => runs.reserve(podId, restored.getPod(podId).activeScript!, 0, trigger).run.id)
  new Scheduler(restored, { start: resumed }, () => retry.at).tick()
  expect(resumed).toHaveBeenCalledWith(pod, { reason: 'event', eventIds: [input] })
  const second = resumed.mock.results[0]!.value as string
  runs.finish(second, 'completed', 'Recovered', null, [input])
  expect(restored.db.prepare('SELECT state FROM accepted_events WHERE id=?').get(input)?.state).toBe('processed')
})

it('keeps delayed retries paused and isolates them when their resource binding changes', () => {
  const f = fixture(); const pod = f.pod()
  f.scheduler.acceptEvent(pod, 'fixture', 'retry', {}); f.scheduler.tick()
  f.runs.finish(f.started[0]!.id, 'failed', 'Run failed', 'Permission service temporarily unavailable', [], 0)
  f.time(f.scheduler.view(pod).retry!.at)
  f.scheduler.lifecycle(pod, 1, 'paused'); f.scheduler.tick(); expect(f.started).toHaveLength(1)
  f.scheduler.lifecycle(pod, 1, 'active')
  f.store.db.prepare('INSERT INTO resource_epochs VALUES(?,1)').run(pod)
  f.scheduler.tick()
  expect(f.started).toHaveLength(1)
  expect(f.scheduler.view(pod)).toMatchObject({ blocked: 0, pending: 0, failed: 1 })
})

it('retries a failed run that already wrote externally; the script owns idempotency', () => {
  const f = fixture(); const pod = f.pod()
  f.scheduler.acceptEvent(pod, 'fixture', 'written', {}); f.scheduler.tick()
  const id = f.started[0]!.id
  f.store.db.prepare('INSERT INTO effect_ledger VALUES(?,\'sent\',\'http.request\',\'hash\',?,\'completed\',\'{}\')').run(pod, id)
  f.runs.finish(id, 'failed', 'Run failed', 'Permission service temporarily unavailable', [], 0)
  expect(f.scheduler.view(pod)).toMatchObject({ blocked: 0, pending: 1, retry: { attempt: 1 } })
  f.time(f.scheduler.view(pod).retry!.at); f.scheduler.tick()
  expect(f.started).toHaveLength(2)
})

it.each(['pending', 'denied', 'revoked'])('keeps later triggers eligible after a pre-effect %s permission result', (state) => {
  const f = fixture(); const pod = f.pod()
  const input = f.scheduler.acceptEvent(pod, 'schedule', 'permission-check', {})
  f.scheduler.tick()
  const id = f.started[0]!.id
  f.runs.append(id, 'approval', { grantId: 'permission-1', issuer: 'https://id.example.test', title: 'Read assigned data', state })
  f.runs.finish(id, 'failed', 'Permission unavailable', `Permission ${state}`, [], 0, { cause: 'permission' })
  expect(f.scheduler.view(pod)).toMatchObject({ blocked: 0, pending: 0, failed: 1 })
  expect(f.store.db.prepare('SELECT state FROM accepted_events WHERE id=?').get(input)?.state).toBe('failed')
  const next = f.scheduler.acceptEvent(pod, 'schedule', 'next-permission-check', {})
  f.scheduler.tick()
  expect(f.started).toHaveLength(2)
  expect(f.started[1]!.trigger.eventIds).toEqual([next])
  f.runs.finish(f.started[1]!.id, 'completed', 'Permission checked again', null, [next])
})

it.each(['completed', 'unknown'])('runs the next trigger after a %s external effect and an unavailable permission', (state) => {
  const f = fixture(); const pod = f.pod()
  f.scheduler.acceptEvent(pod, 'schedule', 'effect-before-permission', {}); f.scheduler.tick()
  const id = f.started[0]!.id
  f.store.db.prepare('INSERT INTO effect_ledger VALUES(?,\'write\',\'http.request\',\'hash\',?,?,?)').run(pod, id, state, state === 'completed' ? '{}' : null)
  f.runs.finish(id, 'failed', 'Permission unavailable', 'Permission denied', [], 0, { cause: 'permission' })
  f.scheduler.acceptEvent(pod, 'schedule', 'next-permission-check', {}); f.scheduler.tick()
  expect(f.started).toHaveLength(2)
  expect(f.scheduler.view(pod)).toMatchObject({ blocked: 0, failed: 1 })
})

it('isolates invalid authority and runs later triggers', () => {
  const f = fixture(); const pod = f.pod()
  f.scheduler.acceptEvent(pod, 'schedule', 'invalid-authority', {}); f.scheduler.tick()
  f.runs.finish(f.started[0]!.id, 'failed', 'Invalid authority', 'Token binding mismatch', [], 0, { cause: 'authority' })
  expect(f.runs.get(f.started[0]!.id).automaticRecovery).toMatchObject({ disposition: 'isolated' })
  f.scheduler.acceptEvent(pod, 'schedule', 'next-permission-check', {}); f.scheduler.tick()
  expect(f.started).toHaveLength(2)
})

it.each(['process', 'checkpoint'])('recovers from %s work after verified settlement without losing committed progress', (kind) => {
  const f = fixture(); const pod = f.pod()
  f.scheduler.acceptEvent(pod, 'fixture', 'unsafe', {}); f.scheduler.tick()
  const id = f.started[0]!.id
  if (kind === 'process') f.runs.append(id, 'process', { pid: 123 })
  if (kind === 'checkpoint') f.store.commitProgress({ podId: pod, expectedRevision: 0, checkpoint: { saved: true }, sources: [], claims: [] })
  f.runs.finish(id, 'failed', 'Run failed', 'Permission service temporarily unavailable', [], 0)
  expect(f.scheduler.view(pod)).toMatchObject({ blocked: 0, pending: 1, retry: { attempt: 1 } })
  f.time(f.scheduler.view(pod).retry!.at); f.scheduler.tick()
  expect(f.started).toHaveLength(2)
  expect(f.runs.get(id).state).toBe('failed')
})

it('isolates a poison batch after five attempts and admits the next scheduled observation', () => {
  const f = fixture(); const pod = f.pod()
  f.scheduler.save(pod, 0, { kind: 'interval', seconds: 60 }, true)
  const input = f.scheduler.acceptEvent(pod, 'fixture', 'poison', {})
  f.scheduler.tick()
  for (let attempt = 0; attempt < 5; attempt++) {
    const run = f.started.at(-1)!
    expect(run.trigger.eventIds).toEqual([input])
    f.runs.finish(run.id, 'failed', 'Bad data', 'Invalid input')
    const retry = f.scheduler.view(pod).retry
    if (retry) { f.time(retry.at); f.scheduler.tick() }
  }
  expect(f.started).toHaveLength(5)
  expect(f.scheduler.view(pod)).toMatchObject({ blocked: 0, failed: 1 })
  expect(f.store.db.prepare('SELECT state FROM accepted_events WHERE id=?').get(input)?.state).toBe('failed')
  f.time(Date.now() + 120000); f.scheduler.tick()
  expect(f.started).toHaveLength(6)
  expect(f.started.at(-1)!.trigger.eventIds).not.toContain(input)
})

it('does not let an unknown delivery prevent the next run, which may send the same key again', () => {
  const f = fixture(); const pod = f.pod()
  f.scheduler.acceptEvent(pod, 'fixture', 'send', {}); f.scheduler.tick()
  const id = f.started[0]!.id
  const ledger = new EffectLedger(f.store)
  expect(ledger.begin(pod, id, 'original', 'http.request', { body: 'one' }).execute).toBe(true)
  ledger.markUnknown(pod, 'original')
  f.runs.finish(id, 'failed', 'Delivery failed', 'No receipt')
  f.scheduler.acceptEvent(pod, 'fixture', 'new-key', {}); f.time(Date.now() + 600000); f.scheduler.tick()
  expect(f.started).toHaveLength(2)
  const next = f.started[1]!.id
  expect(ledger.begin(pod, next, 'original', 'http.request', { body: 'one' }).execute).toBe(true)
  expect(() => ledger.begin(pod, next, 'original', 'http.request', { body: 'one' })).toThrow('already being sent')
  ledger.complete(pod, 'original', { status: 200 })
  expect(ledger.begin(pod, next, 'original', 'http.request', { body: 'one' })).toEqual({ execute: false, result: { status: 200 } })
})

it('starts the Pod again on the next schedule tick after app shutdown cancelled a run that wrote externally', () => {
  const f = fixture(); const pod = f.pod()
  f.scheduler.save(pod, 0, { kind: 'interval', seconds: 60 }, true)
  f.time(61000); f.scheduler.tick()
  const id = f.started[0]!.id
  f.store.db.prepare('INSERT INTO effect_ledger VALUES(?,\'label\',\'program.call\',\'hash\',?,\'completed\',\'{}\')').run(pod, id)
  f.runs.finish(id, 'cancelled', 'Run cancelled', 'Application is quitting', [], 0, { cause: 'shutdown' })
  f.time(Date.now() + 61000); f.scheduler.tick()
  expect(f.started).toHaveLength(2)
  expect(f.scheduler.view(pod)).toMatchObject({ blocked: 0 })
})

it('keeps owner cancellation separate from shutdown and preserves future schedules', () => {
  for (const cause of ['owner-cancelled', 'shutdown'] as const) {
    const f = fixture(); const pod = f.pod()
    f.scheduler.acceptEvent(pod, 'schedule', cause, {}); f.scheduler.tick()
    f.runs.finish(f.started[0]!.id, 'cancelled', 'Stopped', cause, [], 0, { cause })
    expect(f.scheduler.view(pod).blocked).toBe(0)
    expect(f.scheduler.view(pod).pending).toBe(cause === 'shutdown' ? 1 : 0)
    expect(f.scheduler.view(pod).failed).toBe(cause === 'owner-cancelled' ? 1 : 0)
  }
})

it('reconciles a legacy shutdown exactly once and preserves the original input', async () => {
  const f = fixture(); const pod = f.pod()
  const input = f.scheduler.acceptEvent(pod, 'schedule', 'historic', {}); f.scheduler.tick()
  const id = f.started[0]!.id
  f.store.db.prepare('UPDATE runs SET state=\'cancelled\',error=\'Application is quitting\',finished_at=? WHERE id=?').run(Date.now(), id)
  f.store.db.prepare('UPDATE accepted_events SET state=\'blocked\' WHERE id=?').run(input)
  f.store.db.prepare('DELETE FROM run_leases WHERE run_id=?').run(id)
  await recoverStoppedRuns(f.store, '/unused'); await recoverStoppedRuns(f.store, '/unused')
  expect(f.scheduler.view(pod)).toMatchObject({ blocked: 0, pending: 1, retry: { attempt: 1 } })
  expect(f.store.db.prepare('SELECT count(*) AS count FROM run_events WHERE run_id=? AND type=\'recovery\'').get(id)?.count).toBe(1)
  expect(f.runs.get(id).state).toBe('cancelled')
})

it('keeps the lease of a run whose process stop is unconfirmed and checks again later instead of holding it', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  try {
    const f = fixture(); const pod = f.pod()
    f.scheduler.acceptEvent(pod, 'fixture', 'historic', {}); f.scheduler.tick()
    const id = f.started[0]!.id
    f.store.db.prepare('UPDATE runs SET state=\'interrupted\' WHERE id=?').run(id)
    f.store.db.prepare('INSERT INTO execution_domains VALUES(?,?,?)').run(join(f.store.root, 'runs', id, `domain-${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}.record`), id, 4242)
    await recoverStoppedRuns(f.store, join(f.store.root, 'missing-helper'))
    expect(f.store.db.prepare('SELECT run_id FROM run_leases WHERE pod_id=?').get(pod)?.run_id).toBe(id)
    expect(f.store.db.prepare('SELECT 1 FROM run_events WHERE run_id=? AND type=\'recovery\'').get(id)).toBeUndefined()
    f.scheduler.acceptEvent(pod, 'fixture', 'parallel', {}); f.scheduler.tick()
    expect(f.started).toHaveLength(1)
    const helper = join(f.store.root, 'quiescent-helper')
    writeFileSync(helper, '#!/bin/sh\necho \'{"quiescent":true}\'\n', { mode: 0o700 })
    await recoverStoppedRuns(f.store, helper)
    expect(f.store.db.prepare('SELECT 1 FROM run_leases WHERE pod_id=?').get(pod)).toBeDefined()
    vi.setSystemTime(Date.now() + stoppedRunRecheckMs)
    await recoverStoppedRuns(f.store, helper)
    expect(f.store.db.prepare('SELECT 1 FROM run_leases WHERE pod_id=?').get(pod)).toBeUndefined()
    f.time(Date.now() + 60000); f.scheduler.tick()
    expect(f.started).toHaveLength(2)
  }
  finally { vi.useRealTimers() }
})

it('runs Pods of a profile whose inputs and lease an earlier version held for owner review', async () => {
  const f = fixture(); const finished = f.pod(); const leased = f.pod()
  for (const pod of [finished, leased]) f.scheduler.acceptEvent(pod, 'fixture', 'held', {})
  f.scheduler.tick()
  const hold = { disposition: 'hold', reason: 'This run already wrote externally; review its effects before retrying', cause: 'failure', nextAt: null, attempt: 1 }
  const [first, second] = f.started.map(run => run.id)
  f.runs.finish(first!, 'completed', 'Done', null, [])
  f.store.db.prepare('UPDATE accepted_events SET state=\'blocked\',error=? WHERE run_id=?').run(hold.reason, first)
  f.runs.append(first!, 'recovery', hold)
  f.store.db.prepare('UPDATE runs SET state=\'interrupted\' WHERE id=?').run(second)
  f.store.db.prepare('UPDATE run_leases SET boot_id=\'fenced:old\' WHERE run_id=?').run(second)
  f.store.db.prepare('UPDATE accepted_events SET state=\'blocked\',error=? WHERE run_id=?').run(hold.reason, second)
  f.runs.append(second!, 'recovery', hold)
  const queued = f.scheduler.acceptEvent(finished, 'fixture', 'never-started', {})
  f.store.db.prepare('UPDATE accepted_events SET state=\'blocked\' WHERE id=?').run(queued)
  for (let repeat = 0; repeat < 2; repeat++) { releaseHeldWork(f.store); await recoverStoppedRuns(f.store, '/unused') }
  expect(f.store.db.prepare('SELECT count(*) AS count FROM accepted_events WHERE state=\'blocked\'').get()!.count).toBe(0)
  expect(f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(0)
  f.time(Date.now() + 600000); f.scheduler.tick()
  expect(f.started.slice(2).map(run => run.podId).sort()).toEqual([finished, leased].sort())
})

it('frees the execution slot of a run while it waits for an IdP decision and takes it back afterwards', () => {
  const f = fixture(); const pods = [f.pod(), f.pod(), f.pod()]
  f.scheduler.concurrency(1)
  for (const pod of pods) f.scheduler.save(pod, 0, { kind: 'interval', seconds: 60 }, true)
  const approval = (state: string) => ({ grantId: 'grant-1', issuer: 'https://id.example.test', title: 'Run the Pod', state })
  f.time(61000); f.scheduler.tick()
  expect(f.started).toHaveLength(1)
  f.runs.append(f.started[0]!.id, 'approval', approval('pending'))
  f.scheduler.tick()
  expect(f.started).toHaveLength(2)
  expect(f.started[1]!.podId).not.toBe(f.started[0]!.podId)
  f.runs.append(f.started[0]!.id, 'approval', approval('approved'))
  f.scheduler.tick()
  expect(f.started).toHaveLength(2)
})
