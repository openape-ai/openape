// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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
  const pod = (active = true) => { const created = store.createPod({ name: 'Synthetic', assignment: 'Process synthetic events only' }); if (active) scheduler.lifecycle(created.id, created.revision, 'active'); installExample(store, resources, created.id, 'deterministic', 'a'.repeat(64)); return created.id }
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
    for (let i = 1; i < 1000; i++) next.acceptEvent(pod, 'fixture', String(i), {})
    expect(() => next.acceptEvent(pod, 'fixture', 'overflow', {})).toThrow('full')
    expect(next.acceptEvent(pod, 'fixture', 'before-ack', {})).toBe(accepted)
  })
  it('holds failed inputs for explicit recovery and makes invalid version dispatch visible', () => {
    const f = fixture(); const pod = f.pod()
    f.scheduler.acceptEvent(pod, 'fixture', 'A', {}); f.scheduler.tick()
    f.runs.finish(f.started[0]!.id, 'failed', 'Failed', 'Synthetic failure')
    f.scheduler.acceptEvent(pod, 'fixture', 'B', {}); f.scheduler.tick()
    expect(f.started).toHaveLength(1); expect(f.scheduler.view(pod)).toMatchObject({ blocked: 1, pending: 1 })
    const other = f.store.createPod({ name: 'Unconfigured', assignment: 'No script' })
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
