// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { PodDatabase } from '../../src/worker/storage/database'
import { ResourceRegistry } from '../../src/worker/resources/registry'
import { RunDispatcher } from '../../src/worker/runs/dispatcher'
import { installExample } from '../../src/worker/runs/examples'
import { executeScript } from '../../src/worker/runs/runner'
import { recoveryHold, unresolvedOperation } from '../../src/worker/recovery/policy'
import { AuthorityError, NonRetryableError, PermissionUnavailableError } from '../../src/contracts/infrastructure'
import { executeOwnerScript } from '../../src/worker/runs/owner-script'
import { EffectLedger } from '../../src/worker/recovery/effects'
import type { AgentRuntime } from '../../src/worker/agent/executor'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
const stores: PodDatabase[] = []
afterEach(() => { vi.mocked(executeScript).mockReset(); for (const store of stores.splice(0)) { store.close(); rmSync(store.root, { recursive: true, force: true }) } })
function fixture() {
  const store = new PodDatabase(mkdtempSync(join(tmpdir(), 'pods-owner-script-'))); stores.push(store)
  const resources = new ResourceRegistry(store, () => {}); const pod = store.createPod({ name: 'Owner activation' })
  installExample(store, resources, pod.id, 'deterministic', 'a'.repeat(64))
  vi.spyOn(resources, 'capture').mockResolvedValue({ id: randomUUID(), files: [] } as never)
  const hash = store.getPod(pod.id).activeScript!
  const row = store.db.prepare('SELECT manifest FROM scripts WHERE pod_id=? AND hash=?').get(pod.id, hash)!
  const manifest = JSON.parse(String(row.manifest)); manifest.capabilities = ['tool.app_fixture.invoke']
  store.db.prepare('UPDATE scripts SET manifest=? WHERE pod_id=? AND hash=?').run(JSON.stringify(manifest), pod.id, hash)
  vi.spyOn(resources, 'list').mockReturnValue([{ kind: 'tool', state: 'ready', configuration: { capability: 'tool.app_fixture.invoke' } }] as never)
  const tool = vi.fn(async () => { throw new PermissionUnavailableError('A synthetic inner permission is missing') })
  const dispatcher = new RunDispatcher(store, resources, { helper: '/unused', environment: {} } as AgentRuntime, { tool })
  return { store, resources, pod, dispatcher, tool }
}

it('does not turn a verified failed root process into an external effect or prevent the next trigger', async () => {
  const f = fixture()
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, _input, _signal, hooks) => {
    const authority = await hooks.authorizeStart!()
    await hooks.execution!.authorized({ authority, write: false })
    await expect(hooks.request('tools.invoke', { application: 'fixture', argv: [] }, _signal)).rejects.toBeInstanceOf(PermissionUnavailableError)
    await hooks.execution!.completed!({ exitCode: 1 })
    throw new Error('Script propagated the inner refusal')
  })
  const first = f.dispatcher.start(f.pod.id)
  await expect.poll(() => f.dispatcher.runs.get(first).state).toBe('failed')
  expect(f.dispatcher.runs.get(first).automaticRecovery).toMatchObject({ disposition: 'isolated', cause: 'permission' })
  expect(f.store.db.prepare('SELECT count(*) AS n FROM effect_ledger').get()!.n).toBe(0)
  expect(unresolvedOperation(f.store, f.pod.id)).toBe(false)
  const second = f.dispatcher.start(f.pod.id, { reason: 'schedule', eventIds: [] })
  expect(second).not.toBe(first)
  await expect.poll(() => f.dispatcher.runs.get(second).state).toBe('failed')
})

it('keeps an unknown root held after the owner start was acknowledged', async () => {
  const f = fixture()
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, _input, _signal, hooks) => {
    await hooks.execution!.authorized({ authority: await hooks.authorizeStart!(), write: false })
    throw new Error('Root process stopped without a verified receipt')
  })
  const id = f.dispatcher.start(f.pod.id)
  await expect.poll(() => f.dispatcher.runs.get(id).state).toBe('failed')
  expect(unresolvedOperation(f.store, f.pod.id)).toBe(true)
  expect(() => f.dispatcher.start(f.pod.id)).toThrow('without replay evidence')
})

it('retains real inner effects after a verified root completion', async () => {
  const f = fixture()
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, input, _signal, hooks) => {
    await hooks.execution!.authorized({ authority: await hooks.authorizeStart!(), write: false })
    const ledger = new EffectLedger(f.store); ledger.begin(f.pod.id, input.runId, 'synthetic-write', 'program.call', {}); ledger.complete(f.pod.id, 'synthetic-write', { exitCode: 0 })
    await hooks.execution!.completed!({ exitCode: 0 })
    throw new PermissionUnavailableError('A later permission is unavailable')
  })
  const id = f.dispatcher.start(f.pod.id)
  await expect.poll(() => f.dispatcher.runs.get(id).state).toBe('failed')
  expect(unresolvedOperation(f.store, f.pod.id)).toBe(false)
  expect(recoveryHold(f.store, f.pod.id, id, true)).toContain('already wrote externally')
  expect(f.dispatcher.runs.get(id).automaticRecovery?.disposition).toBe('hold')
})

it('rechecks activation and refuses an invalidated script before acknowledging dispatch', async () => {
  const f = fixture()
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, _input, _signal, hooks) => {
    expect((await hooks.authorizeStart!()).source).toBe('owner-activation')
    f.store.db.prepare('DELETE FROM validations WHERE pod_id=?').run(f.pod.id)
    await hooks.authorizeStart!()
    throw new Error('Must not dispatch')
  })
  const id = f.dispatcher.start(f.pod.id)
  await expect.poll(() => f.dispatcher.runs.get(id).state).toBe('failed')
  expect(f.dispatcher.runs.get(id).error).toContain('Owner activation changed')
  expect(f.store.db.prepare('SELECT count(*) AS n FROM run_events WHERE run_id=? AND type=\'root-script\'').get(id)!.n).toBe(0)
})

it.each(['blocked', 'completed'] as const)('uses a trusted pending inner reply only for an unsuccessful script result (%s)', async (status) => {
  const f = fixture()
  f.tool.mockResolvedValue({ exitCode: 75, pending: { grantId: 'synthetic-pending', approvalUrl: 'https://id.example.test/approval' } } as never)
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, input, signal, hooks) => {
    await hooks.execution!.authorized({ authority: await hooks.authorizeStart!(), write: false })
    const pending = await hooks.request('tools.invoke', { application: 'fixture', argv: [], approvalWaitMs: 0 }, signal)
    expect(pending).toMatchObject({ exitCode: 75, pending: { grantId: 'synthetic-pending' } })
    await hooks.execution!.completed!({ exitCode: 0 })
    return { status, summary: 'Synthetic pending permission handled', completedInputIds: input.eventIds, gapIds: [] }
  })
  const id = f.dispatcher.start(f.pod.id)
  await expect.poll(() => f.dispatcher.runs.get(id).state).toBe(status)
  expect(f.tool).toHaveBeenCalledOnce()
  expect(unresolvedOperation(f.store, f.pod.id)).toBe(false)
  if (status === 'blocked') expect(f.dispatcher.runs.get(id).automaticRecovery).toMatchObject({ cause: 'permission', disposition: 'isolated' })
  else expect(f.dispatcher.runs.get(id).automaticRecovery).toBeUndefined()
})

it.each([
  [AuthorityError, 'authority', 'hold'],
  [NonRetryableError, 'non-retryable', 'isolated'],
] as const)('keeps a prior %s classification after later pending and unavailable permissions', async (ErrorClass, cause, disposition) => {
  const f = fixture()
  f.tool.mockRejectedValueOnce(new ErrorClass('Synthetic hard refusal'))
    .mockResolvedValueOnce({ exitCode: 75, pending: { grantId: 'synthetic-pending' } } as never)
    .mockRejectedValueOnce(new PermissionUnavailableError('Synthetic permission unavailable'))
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, _input, signal, hooks) => {
    await hooks.execution!.authorized({ authority: await hooks.authorizeStart!(), write: false })
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await hooks.request('tools.invoke', { application: 'fixture', argv: [] }, signal) }
      catch {}
    }
    await hooks.execution!.completed!({ exitCode: 0 })
    return { status: 'blocked', summary: 'Synthetic script handled service errors', completedInputIds: [], gapIds: [] }
  })
  const id = f.dispatcher.start(f.pod.id)
  await expect.poll(() => f.dispatcher.runs.get(id).state).toBe('blocked')
  expect(f.tool).toHaveBeenCalledTimes(3)
  expect(f.dispatcher.runs.get(id).automaticRecovery).toMatchObject({ cause, disposition })
})

it('does not let a fenced worker settle the root boundary', async () => {
  const f = fixture()
  const run = f.dispatcher.runs.reserve(f.pod.id, f.store.getPod(f.pod.id).activeScript!, f.resources.epoch(f.pod.id)).run
  const authority = { source: 'owner-activation' as const, activationId: 'fence-fixture', podId: f.pod.id, scriptHash: run.scriptHash, assignmentRevision: f.pod.bindingRevision, resourceEpoch: f.resources.epoch(f.pod.id) }
  await executeOwnerScript(f.dispatcher.runs, run.id, authority, async (observer) => {
    await observer.authorized({ authority, write: false })
    f.store.db.prepare('UPDATE run_leases SET boot_id=? WHERE run_id=?').run('fenced-worker', run.id)
    await expect(observer.completed!({ exitCode: 0 })).rejects.toThrow('no longer owned')
  })
  expect(unresolvedOperation(f.store, f.pod.id)).toBe(true)
  expect(f.store.db.prepare('SELECT count(*) AS n FROM run_events WHERE run_id=? AND type=\'recovery-boundary-result\'').get(run.id)!.n).toBe(0)
})
