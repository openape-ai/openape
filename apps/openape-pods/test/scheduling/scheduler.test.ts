// @vitest-environment node
import { scheduleDomains } from '../../src/worker/scheduling/fair-scheduler'
import { boundedStep } from '../../src/worker/scheduling/tick-step'
import { mkdtempSync, rmSync } from 'node:fs'
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
  it('holds failed inputs for explicit recovery and makes invalid version dispatch visible', () => {
    const f = fixture(); const pod = f.pod()
    f.scheduler.acceptEvent(pod, 'fixture', 'A', {}); f.scheduler.tick()
    f.runs.finish(f.started[0]!.id, 'failed', 'Failed', 'Synthetic failure')
    f.scheduler.acceptEvent(pod, 'fixture', 'B', {}); f.scheduler.tick()
    expect(f.started).toHaveLength(1); expect(f.scheduler.view(pod)).toMatchObject({ blocked: 1, pending: 1, error: 'Synthetic failure' })
    expect(f.scheduler.view(pod).blockedSince).toBe(f.store.db.prepare('SELECT finished_at FROM runs WHERE id=?').get(f.started[0]!.id)!.finished_at)
    const other = f.store.createPod({ name: 'Unconfigured' })
    f.scheduler.requestManual(other.id)
    expect(f.scheduler.view(other.id).blocked).toBe(1)
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

it('keeps delayed retries paused and blocks them when their resource binding changes', () => {
  const f = fixture(); const pod = f.pod()
  f.scheduler.acceptEvent(pod, 'fixture', 'retry', {}); f.scheduler.tick()
  f.runs.finish(f.started[0]!.id, 'failed', 'Run failed', 'Permission service temporarily unavailable', [], 0)
  f.time(f.scheduler.view(pod).retry!.at)
  f.scheduler.lifecycle(pod, 1, 'paused'); f.scheduler.tick(); expect(f.started).toHaveLength(1)
  f.scheduler.lifecycle(pod, 1, 'active')
  f.store.db.prepare('INSERT INTO resource_epochs VALUES(?,1)').run(pod)
  f.scheduler.tick()
  expect(f.started).toHaveLength(1)
  expect(f.scheduler.view(pod)).toMatchObject({ blocked: 1, pending: 0, error: expect.stringContaining('permissions changed') })
})

it.each(['process', 'effect', 'checkpoint'])('never automatically restarts after %s work', (kind) => {
  const f = fixture(); const pod = f.pod()
  f.scheduler.acceptEvent(pod, 'fixture', 'unsafe', {}); f.scheduler.tick()
  const id = f.started[0]!.id
  if (kind === 'process') f.runs.append(id, 'process', { pid: 123 })
  if (kind === 'effect') f.store.db.prepare('INSERT INTO effect_ledger VALUES(?,\'sent\',\'http.request\',\'hash\',?,\'completed\',\'{}\')').run(pod, id)
  if (kind === 'checkpoint') f.store.commitProgress({ podId: pod, expectedRevision: 0, checkpoint: { saved: true }, sources: [], claims: [] })
  f.runs.finish(id, 'failed', 'Run failed', 'Permission service temporarily unavailable', [], 0)
  expect(f.scheduler.view(pod)).toMatchObject({ blocked: 1, pending: 0 })
  expect(f.scheduler.view(pod).retry).toBeUndefined()
})

it('rotates standalone, workflow and network domain admission under the same exclusive one-slot limit', () => {
  const f = fixture(); const pods = [f.pod(), f.pod(), f.pod()]
  f.store.db.prepare('UPDATE settings SET concurrency=1 WHERE id=1').run()
  const admitted: number[] = []; let runId = ''
  const domains = pods.map((podId, domain) => () => {
    if (f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count) return
    runId = f.runs.reserve(podId, f.store.getPod(podId).activeScript!, f.resources.epoch(podId), { reason: 'manual', eventIds: [] }).run.id
    admitted.push(domain)
  }) as [() => void, () => void, () => void]
  for (let turn = 0; turn < 9; turn++) {
    scheduleDomains(f.store, domains)
    expect(f.store.db.prepare('SELECT count(*) AS count FROM run_leases').get()!.count).toBe(1)
    f.runs.finish(runId, 'completed', 'Synthetic domain work', null)
  }
  expect(admitted).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2])
  expect(f.store.db.prepare('SELECT last_progress_at FROM network_scheduler_state').get()!.last_progress_at).toBeGreaterThan(0)
})

it('records a failed scheduling domain and admits unrelated work in the same rotation', () => {
  const f = fixture(); const called: number[] = []
  const failure = new Error('Synthetic workflow configuration failure')
  scheduleDomains(f.store, [() => { called.push(0) }, () => { throw failure }, () => { called.push(2) }])
  expect(called).toEqual([0, 2])
  expect(f.store.db.prepare('SELECT last_error_domain,last_error FROM network_scheduler_state').get()).toEqual({ last_error_domain: 1, last_error: failure.message })
  scheduleDomains(f.store, [() => {}, () => {}, () => {}])
  expect(f.store.db.prepare('SELECT last_error FROM network_scheduler_state').get()!.last_error).toBeNull()
})
