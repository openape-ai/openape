// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PodDatabase } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { RunStore } from '../../src/worker/runs/store'
import { executeOwnerScript, ownerScriptAuthority } from '../../src/worker/runs/owner-script'
import { RunDispatcher } from '../../src/worker/runs/dispatcher'
import type { AgentRuntime } from '../../src/worker/agent/executor'
import { installExample } from '../../src/worker/runs/examples'
import { Recovery } from '../../src/worker/recovery/reconcile'
import { Scheduler } from '../../src/worker/scheduling/scheduler'
import { unresolvedOperation } from '../../src/worker/recovery/policy'
import { parseRunView } from '../../src/contracts/runs'
import { parseMapView } from '../../src/contracts/map-view'
import { mapView } from '../../src/worker/workspace/map-view'

const probes = vi.hoisted(() => ({ inspect: vi.fn() }))
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<object>(),
  execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: probes.inspect }),
}))
const stores: PodDatabase[] = []
beforeEach(() => { probes.inspect.mockResolvedValue({ stdout: JSON.stringify({ quiescent: true, reason: 'confirmed-closed' }) }) })
afterEach(() => { vi.resetAllMocks(); for (const store of stores.splice(0)) { store.close(); rmSync(store.root, { recursive: true, force: true }) } })

async function fixture() {
  const store = new PodDatabase(mkdtempSync(join(tmpdir(), 'pods-root-observation-'))); stores.push(store)
  const resources = new ResourceRegistry(store, () => {}); const pod = store.createPod({ name: 'Root observation' })
  installExample(store, resources, pod.id, 'deterministic', 'a'.repeat(64))
  const starts: string[] = []
  const scheduler = new Scheduler(store, { start: (id) => { starts.push(id); return 'unused' } })
  const event = scheduler.acceptEvent(pod.id, 'schedule', 'synthetic-slot', {})
  const runs = new RunStore(store)
  const run = runs.reserve(pod.id, store.getPod(pod.id).activeScript!, 0, { reason: 'schedule', eventIds: [event] }).run
  const authority = ownerScriptAuthority({ podId: pod.id, scriptHash: run.scriptHash, assignmentRevision: pod.bindingRevision, resourceEpoch: 0 })
  const key = `owner-script:${run.id}`
  const domain = join(store.root, 'runs', run.id, `domain-${randomUUID()}.record`)
  runs.registerDomain(run.id, domain, process.pid)
  await executeOwnerScript(runs, run.id, authority, async observer => observer.authorized({ authority, write: false }))
  runs.finish(run.id, 'cancelled', 'Synthetic cancellation', 'Synthetic interruption')
  const recovery = new Recovery(store, resources, scheduler, '/synthetic-helper')
  return { store, resources, pod, run, runs, recovery, starts, key, domain, authority }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
function observation(f: Fixture) { return f.runs.events(f.pod.id, f.run.id).filter(event => event.type === 'recovery-boundary-result') }
function amend(f: Fixture, type: string, change: (value: Record<string, unknown>) => void) {
  const row = f.store.db.prepare('SELECT sequence,data FROM run_events WHERE run_id=? AND type=?').get(f.run.id, type)!
  const data = JSON.parse(String(row.data)) as Record<string, unknown>; change(data)
  f.store.db.prepare('UPDATE run_events SET data=? WHERE run_id=? AND sequence=?').run(JSON.stringify(data), f.run.id, row.sequence)
}

it.each([false, true])('records an owner observation (applied=%s) without process success, queue changes or retry', async (applied) => {
  const f = await fixture()
  const history = f.store.db.prepare('SELECT * FROM runs WHERE id=?').get(f.run.id)
  const queue = f.store.db.prepare('SELECT * FROM accepted_events').all()
  await f.recovery.resolveHttp(f.pod.id, f.run.id, f.key, applied, 'Synthetic receiver and filesystem evidence', applied ? 'partial' : undefined)
  expect(observation(f)).toHaveLength(1)
  expect(observation(f)[0]!.data).toEqual({ id: f.key, operation: 'owner-script', state: 'reconciled', reconciled: 'owner', outcome: applied ? 'partial' : 'not-applied', applied, evidence: 'Synthetic receiver and filesystem evidence', authority: f.authority })
  expect(JSON.stringify(observation(f))).not.toContain('exitCode')
  expect(f.store.db.prepare('SELECT * FROM runs WHERE id=?').get(f.run.id)).toEqual(history)
  expect(f.store.db.prepare('SELECT * FROM accepted_events').all()).toEqual(queue)
  expect(f.store.db.prepare('SELECT * FROM effect_ledger').all()).toEqual([])
  expect(unresolvedOperation(f.store, f.pod.id)).toBe(false)
  expect(f.starts).toEqual([])
  await f.recovery.inspect(f.pod.id, f.run.id)
  expect(f.runs.get(f.run.id).recovery?.state).toBe('ready')
  expect(f.starts).toEqual([])
})

it('uses the historical start after current script and resource bindings have changed', async () => {
  const f = await fixture()
  f.store.db.prepare('UPDATE pods SET active_script=NULL,revision=revision+1 WHERE id=?').run(f.pod.id)
  f.store.db.prepare('INSERT INTO resource_epochs(pod_id,epoch) VALUES(?,7) ON CONFLICT(pod_id) DO UPDATE SET epoch=7').run(f.pod.id)
  await f.recovery.resolveHttp(f.pod.id, f.run.id, f.key, false, 'Original execution proved stopped without effects')
  expect(observation(f)[0]!.data).toMatchObject({ authority: f.authority })
  await expect(f.recovery.retry(f.pod.id, f.run.id)).rejects.toThrow('validated script')
  expect(f.starts).toEqual([])
})

it.each([
  ['source', 'grant'],
  ['activationId', 'foreign-activation'],
  ['podId', '00000000-0000-4000-8000-000000000001'],
  ['scriptHash', 'b'.repeat(64)],
  ['assignmentRevision', 2],
  ['resourceEpoch', 1],
] as const)('refuses a mismatched historical authority field %s', async (field, value) => {
  const f = await fixture()
  amend(f, 'recovery-boundary', (data) => { (data.authority as Record<string, unknown>)[field] = value })
  await expect(f.recovery.resolveHttp(f.pod.id, f.run.id, f.key, false, 'Observation')).rejects.toThrow()
  expect(probes.inspect).not.toHaveBeenCalled(); expect(observation(f)).toEqual([])
})

it.each(['input', 'start', 'authorization', 'boundary-kind', 'boundary-operation', 'authority-extra'])('refuses missing or malformed %s evidence', async (change) => {
  const f = await fixture()
  if (change === 'input') f.store.db.prepare('DELETE FROM run_inputs WHERE run_id=?').run(f.run.id)
  if (change === 'start') amend(f, 'started', (data) => { data.resourceEpoch = 3 })
  if (change === 'authorization') f.store.db.prepare('DELETE FROM run_events WHERE run_id=? AND type=\'root-script\'').run(f.run.id)
  if (change === 'boundary-kind') amend(f, 'recovery-boundary', (data) => { data.kind = 'read' })
  if (change === 'boundary-operation') amend(f, 'recovery-boundary', (data) => { data.operation = 'other.action' })
  if (change === 'authority-extra') amend(f, 'recovery-boundary', (data) => { (data.authority as Record<string, unknown>).approved = true })
  await expect(f.recovery.resolveHttp(f.pod.id, f.run.id, f.key, false, 'Observation')).rejects.toThrow()
  expect(observation(f)).toEqual([])
})

it.each(['foreign-pod', 'foreign-run', 'wrong-key', 'running', 'blank-evidence', 'applied-without-partial', 'partial-without-applied'])('refuses %s before recording an observation', async (change) => {
  const f = await fixture()
  if (change === 'running') f.store.db.prepare('UPDATE runs SET state=\'running\' WHERE id=?').run(f.run.id)
  await expect(f.recovery.resolveHttp(change === 'foreign-pod' ? randomUUID() : f.pod.id, change === 'foreign-run' ? randomUUID() : f.run.id, change === 'wrong-key' ? `owner-script:${randomUUID()}` : f.key, change === 'applied-without-partial', change === 'blank-evidence' ? ' ' : 'Observation', change === 'partial-without-applied' ? 'partial' : undefined)).rejects.toThrow()
  expect(observation(f)).toEqual([])
})

it.each(['absent', 'foreign-path', 'missing-registration', 'live'])('requires positive stopped-domain evidence: %s', async (change) => {
  const f = await fixture()
  if (change === 'absent') f.store.db.prepare('DELETE FROM execution_domains WHERE run_id=?').run(f.run.id)
  if (change === 'foreign-path') f.store.db.prepare('UPDATE execution_domains SET path=? WHERE run_id=?').run(join(f.store.root, 'runs', randomUUID(), `domain-${randomUUID()}.record`), f.run.id)
  if (change === 'missing-registration' || change === 'live') probes.inspect.mockResolvedValue({ stdout: JSON.stringify({ quiescent: false, reason: change === 'live' ? 'previous-domain-still-present' : 'registration-missing' }) })
  await expect(f.recovery.resolveHttp(f.pod.id, f.run.id, f.key, false, 'Observation')).rejects.toThrow()
  expect(unresolvedOperation(f.store, f.pod.id)).toBe(true); expect(observation(f)).toEqual([])
})

it.each(['run', 'input', 'authority', 'domain', 'settled'])('atomically refuses a concurrent %s change during process inspection', async (change) => {
  const f = await fixture()
  probes.inspect.mockImplementationOnce(async () => {
    if (change === 'run') f.store.db.prepare('UPDATE runs SET state=\'running\' WHERE id=?').run(f.run.id)
    if (change === 'input') f.store.db.prepare('UPDATE run_inputs SET reason=\'manual\' WHERE run_id=?').run(f.run.id)
    if (change === 'authority') amend(f, 'root-script', (data) => { (data.authority as Record<string, unknown>).resourceEpoch = 9 })
    if (change === 'domain') f.store.db.prepare('UPDATE execution_domains SET owner_pid=owner_pid+1 WHERE run_id=?').run(f.run.id)
    if (change === 'settled') f.runs.append(f.run.id, 'recovery-boundary-result', { id: f.key, state: 'reconciled', evidence: 'Concurrent owner observation' })
    return { stdout: JSON.stringify({ quiescent: true, reason: 'confirmed-closed' }) }
  })
  await expect(f.recovery.resolveHttp(f.pod.id, f.run.id, f.key, false, 'Observation')).rejects.toThrow()
  expect(observation(f)).toHaveLength(change === 'settled' ? 1 : 0)
})

it('checks every owned domain and refuses a second settlement', async () => {
  const f = await fixture()
  f.store.db.prepare('INSERT INTO execution_domains VALUES(?,?,?)').run(join(f.store.root, 'runs', f.run.id, `domain-${randomUUID()}.record`), f.run.id, process.pid)
  await f.recovery.resolveHttp(f.pod.id, f.run.id, f.key, false, 'Observation')
  expect(probes.inspect).toHaveBeenCalledTimes(2)
  await expect(f.recovery.resolveHttp(f.pod.id, f.run.id, f.key, true, 'Different observation', 'partial')).rejects.toThrow('already settled')
  expect(observation(f)).toHaveLength(1)
})

it.each(['unknown', 'completed'])('preserves inner %s effects and other unresolved boundaries', async (state) => {
  const f = await fixture()
  f.store.db.prepare('INSERT INTO effect_ledger VALUES(?,?,\'program.call\',\'synthetic-input\',?,?,?)').run(f.pod.id, 'inner-effect', f.run.id, state, state === 'completed' ? '{"exitCode":0}' : null)
  const before = f.store.db.prepare('SELECT * FROM effect_ledger').all()
  await f.recovery.resolveHttp(f.pod.id, f.run.id, f.key, false, 'Root observation only')
  expect(f.store.db.prepare('SELECT * FROM effect_ledger').all()).toEqual(before)
  if (state === 'unknown') await expect(f.recovery.inspect(f.pod.id, f.run.id)).rejects.toThrow('unknown outcome')
  f.runs.append(f.run.id, 'recovery-boundary', { id: 'separate-action', kind: 'untracked', operation: 'other.action' })
  await expect(f.recovery.inspect(f.pod.id, f.run.id)).rejects.toThrow('without replay evidence')
  expect(f.starts).toEqual([])
})

it('preserves legacy delivery keys that share only the owner-script prefix', async () => {
  const f = await fixture(); const key = 'owner-script:synthetic-http-key'
  f.store.db.prepare('INSERT INTO effect_ledger VALUES(?,?,\'http.request\',\'synthetic-input\',?,\'unknown\',NULL)').run(f.pod.id, key, f.run.id)
  await f.recovery.resolveHttp(f.pod.id, f.run.id, key, false, 'Synthetic receiver confirms no delivery')
  expect(f.store.db.prepare('SELECT * FROM effect_ledger').all()).toEqual([])
  expect(observation(f)).toEqual([])
  expect(unresolvedOperation(f.store, f.pod.id)).toBe(true)
})

it('discovers exact root keys and authority without exposing script content and removes only settled roots', async () => {
  const f = await fixture()
  const runtime = { helper: '/unused', environment: {} } as AgentRuntime
  const dispatcher = new RunDispatcher(f.store, f.resources, runtime)
  const view = dispatcher.view(f.pod.id)
  expect(view.effects).toEqual([{ key: f.key, runId: f.run.id, authority: f.authority }])
  expect(parseRunView(view).effects).toEqual(view.effects)
  const map = parseMapView(mapView(f.store))
  expect(map.pods.find(pod => pod.id === f.pod.id)!.unknown).toEqual(view.effects)
  expect(map.kpis.unknownDeliveries).toBe(1)
  expect(() => parseMapView({ ...map, pods: [{ ...map.pods[0], unknown: [{ ...view.effects![0], authority: { ...f.authority, podId: randomUUID() } }] }] })).toThrow('does not match')
  f.store.db.prepare('INSERT INTO local_only_pods(pod_id) VALUES(?)').run(f.pod.id)
  expect(parseMapView(mapView(f.store, Date.now(), true)).pods.find(pod => pod.id === f.pod.id)!.unknown).toEqual([])
  expect(() => parseRunView({ ...view, effects: [{ ...view.effects![0], authority: { ...f.authority, approved: true } }] })).toThrow('authority')
  expect(() => parseRunView({ ...view, effects: [{ ...view.effects![0], key: 'foreign-key' }] })).toThrow('does not match')
  await f.recovery.resolveHttp(f.pod.id, f.run.id, f.key, false, 'Observed no effects')
  expect(dispatcher.view(f.pod.id).effects).toEqual([])
  expect(mapView(f.store).pods.find(pod => pod.id === f.pod.id)!.unknown).toEqual([])
})

it('keeps existing large delivery-review lists intact alongside additive root metadata', async () => {
  const f = await fixture()
  for (let index = 0; index < 101; index++) f.store.db.prepare('INSERT INTO effect_ledger VALUES(?,?,\'http.request\',\'synthetic-input\',?,\'unknown\',NULL)').run(f.pod.id, `delivery-${index}`, f.run.id)
  const view = parseMapView(mapView(f.store))
  expect(view.pods.find(pod => pod.id === f.pod.id)!.unknown).toHaveLength(102)
  expect(view.kpis.unknownDeliveries).toBe(102)
})
