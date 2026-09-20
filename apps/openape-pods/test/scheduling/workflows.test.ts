// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { PodDatabase } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { RunStore } from '../../src/worker/runs/store'
import type { RunTrigger } from '../../src/worker/runs/store'
import { installExample } from '../../src/worker/runs/examples'
import { Scheduler } from '../../src/worker/scheduling/scheduler'
import { WorkflowEngine } from '../../src/worker/workflows/engine'
import { parseWorkflowCommand, parseWorkflowView } from '../../src/contracts/workflows'
import { nextWorkflowDue } from '../../src/worker/workflows/clock'
import { publishWorkflowOutput, workflowInput } from '../../src/worker/workflows/handoff'
import { ProgramControl } from '../../src/worker/resources/programs'

const stores: PodDatabase[] = []; const roots: string[] = []
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pods-workflow-')); roots.push(root)
  const store = new PodDatabase(root); stores.push(store)
  const resources = new ResourceRegistry(store, () => {})
  const runs = new RunStore(store); const started: { podId: string, id: string, trigger: RunTrigger }[] = []
  let now = 1000
  const driver = { start: (podId: string, trigger: RunTrigger) => { const run = runs.reserve(podId, store.getPod(podId).activeScript!, resources.epoch(podId), trigger).run; started.push({ podId, id: run.id, trigger }); return run.id }, cancelPod: vi.fn() }
  const recovery = { inspect: vi.fn(async (_podId: string, _runId: string) => {}) }
  const engine = new WorkflowEngine(store, driver, recovery, () => now)
  const scheduler = new Scheduler(store, driver, () => now)
  const pod = () => { const created = store.createPod({ name: 'Synthetic' }); installExample(store, resources, created.id, 'deterministic', 'a'.repeat(64)); return created.id }
  const workflow = (ids: string[], after: string[][] = ids.map(() => []), handoff = false) => {
    const id = randomUUID(); engine.save({ type: 'save', id, revision: 0, name: 'Synthetic graph', nodes: ids.map((podId, index) => ({ podId, after: after[index]!, handoff })), schedule: null, enabled: false }); return id
  }
  const complete = (podId: string, state: 'completed' | 'failed' | 'completedWithGaps' = 'completed') => { const run = [...started].reverse().find(run => run.podId === podId)!; runs.finish(run.id, state, 'Synthetic result', null, run.trigger.eventIds) }
  return { store, resources, runs, engine, scheduler, started, driver, recovery, pod, workflow, complete, time: (instant: number) => { now = instant } }
}
it('runs an unchanged diamond graph with ALL joins and durable completion receipts', () => {
  const f = fixture(); const [a, b, c, d] = [f.pod(), f.pod(), f.pod(), f.pod()]
  const before = f.store.listPods(); const id = f.workflow([a!, b!, c!, d!], [[], [a!], [a!], [b!, c!]])
  expect(f.store.listPods()).toEqual(before)
  const run = f.engine.start(id, 1); f.engine.tick(); f.engine.tick()
  expect(f.started.map(run => run.podId)).toEqual([a])
  f.complete(a!); f.engine.tick(); expect(f.started.map(run => run.podId)).toEqual([a, b, c])
  f.complete(b!); f.engine.tick(); expect(f.started).toHaveLength(3)
  f.complete(c!); f.engine.tick(); f.engine.tick(); expect(f.started.map(run => run.podId)).toEqual([a, b, c, d])
  f.complete(d!); f.engine.tick(); expect(f.engine.run(run).state).toBe('completed')
  expect(f.store.db.prepare('SELECT * FROM workflow_reservations').all()).toEqual([])
  expect(parseWorkflowView(f.engine.view()).runs[0]!.nodes.every(node => node.state === 'completed')).toBe(true)
})
it('rejects cycles, foreign predecessors, duplicate pods and stale edits', () => {
  const f = fixture(); const a = f.pod(); const b = f.pod()
  expect(() => f.workflow([a, b], [[b], [a]])).toThrow('cycle')
  expect(() => f.workflow([a], [[b]])).toThrow('belong')
  expect(() => f.workflow([a, a])).toThrow('unique')
  const id = f.workflow([a])
  expect(() => f.engine.start(id, 0)).toThrow('changed')
  expect(() => parseWorkflowCommand({ type: 'start', id, revision: 1, extra: true })).toThrow('fields')
})
it('reserves whole membership, prevents overlapping triggers and blocks standalone/terminal bypasses', () => {
  const f = fixture(); const a = f.pod(); const b = f.pod(); const c = f.pod()
  const first = f.workflow([a, b], [[], [a]]); const second = f.workflow([b, c], [[], [b]])
  const run = f.engine.start(first, 1); f.engine.tick()
  expect(f.engine.start(first, 1)).toBe(run)
  const waiting = f.engine.start(second, 1); f.engine.tick()
  expect(f.engine.run(waiting)).toMatchObject({ state: 'waiting', reason: 'Waiting for a member pod or unresolved input' })
  expect(f.store.db.prepare('SELECT * FROM workflow_reservations WHERE pod_id=?').get(c)).toBeUndefined()
  expect(() => f.scheduler.requestManual(b)).toThrow('reserved')
  expect(() => f.driver.start(b, { reason: 'manual', eventIds: [] })).toThrow('reserved')
  expect(() => new ProgramControl(f.store, f.resources).execute({ type: 'reserveShell', podId: b, sessionId: randomUUID(), epoch: 0 })).toThrow('reserved')
  f.complete(a); f.engine.tick(); f.complete(b); f.engine.tick()
  expect(f.engine.run(waiting).state).toBe('running')
  expect(f.started.filter(run => run.podId === b)).toHaveLength(2)
})
it('holds descendants after failure while independent branches complete, then retries only failed work', async () => {
  const f = fixture(); const a = f.pod(); const b = f.pod(); const c = f.pod(); const d = f.pod()
  const id = f.workflow([a, b, c, d], [[], [], [a], [b]])
  const run = f.engine.start(id, 1); f.engine.tick(); f.complete(a, 'failed'); f.complete(b); f.engine.tick()
  expect(f.started.map(run => run.podId)).toEqual([a, b, d]); expect(f.engine.run(run).state).toBe('blocked')
  f.complete(d); f.engine.tick(); await f.engine.retry(run, a)
  expect(f.started.map(run => run.podId)).toEqual([a, b, d, a])
  f.complete(a); f.engine.tick(); expect(f.started.at(-1)!.podId).toBe(c)
  expect(f.recovery.inspect).toHaveBeenCalledOnce()
  expect(f.started.filter(run => run.podId === b)).toHaveLength(1)
})
it('does not release successors for completedWithGaps or unknown external effects', () => {
  const f = fixture(); const a = f.pod(); const b = f.pod(); const id = f.workflow([a, b], [[], [a]])
  const run = f.engine.start(id, 1); f.engine.tick(); f.complete(a, 'completedWithGaps'); f.engine.tick()
  expect(f.engine.run(run).state).toBe('blocked'); expect(f.started).toHaveLength(1)
})
it('persists completed siblings across restart and requires explicit recovery for interrupted work', () => {
  const f = fixture(); const a = f.pod(); const b = f.pod(); const c = f.pod()
  const id = f.workflow([a, b, c], [[], [], [a, b]]); const run = f.engine.start(id, 1); f.engine.tick(); f.complete(a)
  f.store.db.prepare('UPDATE runs SET state=\'interrupted\',error=\'Synthetic crash\' WHERE pod_id=?').run(b)
  const reopened = new PodDatabase(f.store.root); stores.push(reopened)
  const restarted = new WorkflowEngine(reopened, f.driver, f.recovery); restarted.tick()
  expect(restarted.run(run).nodes.map(node => node.state)).toEqual(['completed', 'blocked', 'waiting'])
  expect(f.started).toHaveLength(2); expect(reopened.db.prepare('SELECT * FROM workflow_reservations').all()).toHaveLength(3)
})
it('pauses node dispatch and permits an explicit one-shot without changing member lifecycles', () => {
  const f = fixture(); const a = f.pod(); const b = f.pod(); const id = f.workflow([a, b], [[], [a]])
  const run = f.engine.start(id, 1); f.engine.tick(); f.engine.pause(id, 1, true); f.complete(a); f.engine.tick()
  expect(f.started).toHaveLength(1); expect(f.engine.run(run).reason).toBe('Workflow paused by the owner')
  f.engine.pause(id, 2, false); f.engine.tick(); expect(f.started).toHaveLength(2)
  expect(f.store.listPods().every(pod => pod.lifecycle === 'paused')).toBe(true)
})
it('pins the graph and authority while allowing draft changes for future runs', () => {
  const f = fixture(); const a = f.pod(); const b = f.pod(); const id = f.workflow([a, b], [[], [a]])
  const run = f.engine.start(id, 1); f.engine.tick()
  f.engine.save({ type: 'save', id, revision: 1, name: 'Revised', nodes: [{ podId: a, after: [], handoff: false }], schedule: null, enabled: false })
  f.complete(a); f.store.db.prepare('INSERT INTO resource_epochs VALUES(?,1) ON CONFLICT(pod_id) DO UPDATE SET epoch=epoch+1').run(b); f.engine.tick()
  expect(f.engine.run(run).nodes).toHaveLength(2); expect(f.engine.run(run).state).toBe('blocked'); expect(f.started).toHaveLength(1)
})
it('hands off only explicit immutable output, never the predecessor checkpoint', () => {
  const f = fixture(); const a = f.pod(); const b = f.pod(); const id = f.workflow([a, b], [[], [a]], true)
  f.engine.start(id, 1); f.engine.tick()
  const result = { schema: 'synthetic-result/v1', data: { batchId: 'fixed' } }
  publishWorkflowOutput(f.store, f.started[0]!.id, result)
  expect(() => publishWorkflowOutput(f.store, f.started[0]!.id, { ...result, data: { changed: true } })).toThrow('sealed')
  f.complete(a); f.engine.tick()
  expect(workflowInput(f.store, f.started[1]!.id)?.outputs).toEqual({ [a]: result })
})
it('coalesces schedule triggers during active runs and persists a one-time slot exactly once', () => {
  const f = fixture(); const a = f.pod(); const id = f.workflow([a])
  f.engine.save({ type: 'save', id, revision: 1, name: 'Once', nodes: [{ podId: a, after: [], handoff: false }], schedule: { kind: 'once', at: 2000 }, enabled: true })
  f.engine.pause(id, 2, false); f.time(2000); f.engine.tick(); f.engine.tick(); expect(f.started).toHaveLength(1)
  f.complete(a); f.time(5000); f.engine.tick(); expect(f.engine.view().workflows[0]!.nextAt).toBeNull()
  expect(f.started).toHaveLength(1)
})
it('uses the same timezone-aware evaluator for cron and schedule preview with OR day matching', () => {
  const spec = { kind: 'cron' as const, expression: '0 9 1 * 1', timezone: 'Europe/Vienna' }
  expect(new Date(nextWorkflowDue(spec, null, Date.parse('2026-09-20T00:00:00Z'))!).toISOString()).toBe('2026-09-21T07:00:00.000Z')
  const daily = { kind: 'daily' as const, time: '02:30', timezone: 'Europe/Vienna' }
  expect(new Date(nextWorkflowDue(daily, null, Date.parse('2026-03-28T23:00:00Z'))!).toISOString()).toBe('2026-03-29T01:00:00.000Z')
})
it('uses one active run and one node claim across two database connections', () => {
  const f = fixture(); const a = f.pod(); const id = f.workflow([a])
  const otherStore = new PodDatabase(f.store.root); stores.push(otherStore)
  const other = new WorkflowEngine(otherStore, f.driver, f.recovery)
  const run = f.engine.start(id, 1); expect(other.start(id, 1)).toBe(run)
  other.tick(); f.engine.tick()
  expect(f.started).toHaveLength(1)
  expect(otherStore.db.prepare('SELECT * FROM workflow_attempts').all()).toHaveLength(1)
})
it('blocks missing required handoff before starting any successor process', () => {
  const f = fixture(); const a = f.pod(); const b = f.pod(); const id = f.workflow([a, b], [[], [a]], true)
  const run = f.engine.start(id, 1); f.engine.tick(); f.complete(a); f.engine.tick()
  expect(f.started).toHaveLength(1); expect(f.engine.run(run).nodes[1]).toMatchObject({ state: 'blocked', reason: 'A required predecessor output is missing' })
})
it('does not cancel a running node merely because its external effect is still in flight', () => {
  const f = fixture(); const a = f.pod(); const id = f.workflow([a]); f.engine.start(id, 1); f.engine.tick()
  f.store.db.prepare('INSERT INTO effect_ledger VALUES(?,?,?,?,?,?,?)').run(a, 'synthetic', 'http.request', 'a'.repeat(64), f.started[0]!.id, 'intent', null)
  f.engine.tick(); expect(f.driver.cancelPod).not.toHaveBeenCalled()
  f.complete(a); f.engine.tick(); expect(f.engine.view().runs[0]!.state).toBe('blocked')
  expect(f.runs.get(f.started[0]!.id).state).toBe('blocked')
})
it('removes a settled workflow without changing its pods and retains immutable run evidence', () => {
  const f = fixture(); const a = f.pod(); const before = f.store.listPods(); const id = f.workflow([a])
  const run = f.engine.start(id, 1); f.engine.tick()
  expect(() => f.engine.delete(id, 1)).toThrow('Settle')
  f.complete(a); f.engine.tick(); f.engine.delete(id, 1)
  expect(f.engine.view().workflows).toEqual([])
  expect(f.engine.run(run).state).toBe('completed')
  expect(f.store.listPods()).toEqual(before)
  expect(() => f.engine.start(id, 2)).toThrow('not found')
})
it('evaluates cron daylight transitions once using the same preview clock', () => {
  const spec = { kind: 'cron' as const, expression: '30 2 * * *', timezone: 'Europe/Vienna' }
  expect(new Date(nextWorkflowDue(spec, null, Date.parse('2026-03-28T23:00:00Z'))!).toISOString()).toBe('2026-03-29T01:30:00.000Z')
  const first = nextWorkflowDue(spec, null, Date.parse('2026-10-24T22:00:00Z'))!
  expect(new Date(first).toISOString()).toBe('2026-10-25T00:30:00.000Z')
  expect(new Date(nextWorkflowDue(spec, first, first)!).toISOString()).toBe('2026-10-26T01:30:00.000Z')
})
it('settles a paused run once all already-started nodes finish and fences cancellation on unknown effects', async () => {
  const f = fixture(); const a = f.pod(); const id = f.workflow([a]); const run = f.engine.start(id, 1)
  f.engine.tick(); f.engine.pause(id, 1, true); f.complete(a); f.engine.tick()
  expect(f.engine.run(run).state).toBe('completed')
  const next = f.engine.start(id, 2); f.engine.tick()
  const attempt = f.started.at(-1)!.id
  f.store.db.prepare('INSERT INTO effect_ledger VALUES(?,?,?,?,?,?,?)').run(a, 'unknown-on-cancel', 'http.request', 'a'.repeat(64), attempt, 'unknown', null)
  f.complete(a); f.engine.tick()
  await expect(f.engine.cancel(next)).rejects.toThrow('External effects')
  expect(f.engine.run(next).finishedAt).toBeNull()
  expect(f.store.db.prepare('SELECT * FROM workflow_reservations').all()).toHaveLength(1)
})

it('correlates accepted workflow runs durably without starting a duplicate graph', () => {
  const f = fixture(); const pod = f.pod(); const workflow = f.workflow([pod]); const firstOperation = randomUUID(); const secondOperation = randomUUID()
  const runId = f.engine.start(workflow, 1, 'manual', firstOperation)
  expect(f.engine.start(workflow, 1, 'manual', secondOperation)).toBe(runId)
  expect(f.store.db.prepare('SELECT id,run_id,kind FROM control_runs ORDER BY rowid').all()).toEqual([
    { id: firstOperation, run_id: runId, kind: 'workflow' },
    { id: secondOperation, run_id: runId, kind: 'workflow' },
  ])
  expect(f.engine.view().runs).toHaveLength(1)
})
