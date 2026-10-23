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
  const withdraw = vi.fn(async () => ({ outcome: 'withdrawn' as const, grant_id: 'grant-1', previous_status: 'pending' as const }))
  const dispatcher = new RunDispatcher(store, resources, { helper: '/unused', environment: {} } as AgentRuntime, { tool, withdraw })
  return { store, resources, pod, dispatcher, tool, withdraw }
}
const runEvents = (store: PodDatabase, runId: string, type: string) => store.db.prepare('SELECT data FROM run_events WHERE run_id=? AND type=? ORDER BY sequence').all(runId, type).map(row => JSON.parse(String(row.data)))

it('withdraws a referenced request through the Pod identity and records one receipt (issue 1536)', async () => {
  const f = fixture()
  const answers: unknown[] = []
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, input, signal, hooks) => {
    answers.push(await hooks.request('tools.withdraw', { reference: 'archive-v2:abc', reason: 'Mail left the Inbox' }, signal))
    f.withdraw.mockResolvedValueOnce({ outcome: 'already_decided', grant_id: 'grant-2', status: 'used' } as never)
    answers.push(await hooks.request('tools.withdraw', { reference: 'archive-v2:def' }, signal))
    f.withdraw.mockResolvedValueOnce({ outcome: 'unknown' } as never)
    answers.push(await hooks.request('tools.withdraw', { reference: 'archive-v2:ghi' }, signal))
    return { status: 'completed', summary: 'Withdrew stale requests', completedInputIds: input.eventIds, gapIds: [] }
  })
  const id = f.dispatcher.start(f.pod.id)
  await expect.poll(() => f.dispatcher.runs.get(id).state).toBe('completed')
  expect(answers).toEqual([{ outcome: 'withdrawn', grantId: 'grant-1', previous: 'pending' }, { outcome: 'alreadyDecided', grantId: 'grant-2', state: 'used' }, { outcome: 'unknown' }])
  expect(f.withdraw).toHaveBeenNthCalledWith(1, { reference: 'archive-v2:abc', reason: 'Mail left the Inbox' }, expect.any(AbortSignal), expect.objectContaining({ podId: f.pod.id, runId: id }))
  expect(runEvents(f.store, id, 'grant-withdraw')).toEqual([
    { reference: 'archive-v2:abc', reason: 'Mail left the Inbox', outcome: 'withdrawn', grantId: 'grant-1', previous: 'pending' },
    { reference: 'archive-v2:def', outcome: 'alreadyDecided', grantId: 'grant-2', state: 'used' },
    { reference: 'archive-v2:ghi', outcome: 'unknown' },
  ])
  // Withdrawal removes authority only; it never enters the effect journal or holds the Pod.
  expect(f.store.db.prepare('SELECT COUNT(*) AS count FROM effect_ledger WHERE pod_id=?').get(f.pod.id)).toMatchObject({ count: 0 })
  expect(f.tool).not.toHaveBeenCalled()
})

it('refuses malformed withdrawals before contacting the IdP', async () => {
  const f = fixture()
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, input, signal, hooks) => {
    for (const payload of [{}, { reference: '' }, { reference: 'x', grantId: 'grant-1' }, { reference: 'x', reason: 'a\u0000b' }, { reference: 'x'.repeat(513) }, 'archive-v2:abc'])
      await expect(hooks.request('tools.withdraw', payload, signal)).rejects.toThrow()
    return { status: 'completed', summary: 'Refused malformed withdrawals', completedInputIds: input.eventIds, gapIds: [] }
  })
  const id = f.dispatcher.start(f.pod.id)
  await expect.poll(() => f.dispatcher.runs.get(id).state).toBe('completed')
  expect(f.withdraw).not.toHaveBeenCalled()
  expect(runEvents(f.store, id, 'grant-withdraw')).toEqual([])
})

it.each([
  { batch: undefined, reference: undefined },
  { batch: { id: 'selected-objects', title: 'Review selected objects', size: 2 }, reference: undefined },
  { batch: { id: 'selected-objects', title: 'Review selected objects' }, reference: 'document-42:export:v1' },
])('forwards approval metadata separately from unchanged program arguments (%j)', async ({ batch, reference }) => {
  const f = fixture()
  f.tool.mockResolvedValue({ exitCode: 0, stdout: '{}', stderr: '' } as never)
  const call = { application: 'fixture', argv: ['read', '--message', 'immutable-1'], approvalWaitMs: 0 }
  const summary = { title: 'Review this selected object', description: 'Synthetic review context', link: 'https://example.test/review/1' }
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, input, signal, hooks) => {
    await hooks.execution!.authorized({ authority: await hooks.authorizeStart!(), write: false })
    await hooks.request('tools.invoke', { ...call, summary, ...(batch ? { batch } : {}), ...(reference ? { reference } : {}) }, signal)
    await hooks.execution!.completed!({ exitCode: 0 })
    return { status: 'completed', summary: 'Synthetic tool call completed', completedInputIds: input.eventIds, gapIds: [] }
  })
  const id = f.dispatcher.start(f.pod.id)
  await expect.poll(() => f.dispatcher.runs.get(id).state).toBe('completed')
  expect(f.tool).toHaveBeenCalledWith(call, expect.any(AbortSignal), expect.any(Object), summary, batch, reference)
  expect(f.tool).toHaveBeenCalledOnce()
})

it.each(['http.request', 'tools.invoke'])('refuses batch metadata on unsupported %s targets before dispatch', async (operation) => {
  const f = fixture()
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, input, signal, hooks) => {
    await hooks.execution!.authorized({ authority: await hooks.authorizeStart!(), write: false })
    await expect(hooks.request(operation, { ...(operation === 'http.request' ? { url: 'https://example.test/' } : { sshInventory: 'fixture' }), batch: { id: 'selected-objects' } }, signal)).rejects.toThrow('Approval batches require an assigned application call')
    await hooks.execution!.completed!({ exitCode: 0 })
    return { status: 'completed', summary: 'Unsupported batch refused', completedInputIds: input.eventIds, gapIds: [] }
  })
  const id = f.dispatcher.start(f.pod.id)
  await expect.poll(() => f.dispatcher.runs.get(id).state).toBe('completed')
  expect(f.tool).not.toHaveBeenCalled()
})

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
  const second = f.dispatcher.start(f.pod.id, { reason: 'schedule', eventIds: [] })
  expect(second).not.toBe(first)
  await expect.poll(() => f.dispatcher.runs.get(second).state).toBe('failed')
})

it('repeats a run whose root outcome is unknown on the next trigger', async () => {
  const f = fixture()
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, _input, _signal, hooks) => {
    await hooks.execution!.authorized({ authority: await hooks.authorizeStart!(), write: false })
    throw new Error('Root process stopped without a verified receipt')
  })
  const id = f.dispatcher.start(f.pod.id)
  await expect.poll(() => f.dispatcher.runs.get(id).state).toBe('failed')
  expect(f.dispatcher.runs.get(id).automaticRecovery?.disposition).toBe('retry')
  const next = f.dispatcher.start(f.pod.id)
  expect(next).not.toBe(id)
  await expect.poll(() => f.dispatcher.runs.get(next).state).toBe('failed')
})

it('retains real inner effects after a verified root completion without holding the Pod', async () => {
  const f = fixture()
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, input, _signal, hooks) => {
    await hooks.execution!.authorized({ authority: await hooks.authorizeStart!(), write: false })
    const ledger = new EffectLedger(f.store); ledger.begin(f.pod.id, input.runId, 'synthetic-write', 'program.call', {}); ledger.complete(f.pod.id, input.runId, 'synthetic-write', { exitCode: 0 })
    await hooks.execution!.completed!({ exitCode: 0 })
    throw new PermissionUnavailableError('A later permission is unavailable')
  })
  const id = f.dispatcher.start(f.pod.id)
  await expect.poll(() => f.dispatcher.runs.get(id).state).toBe('failed')
  expect(f.store.db.prepare('SELECT state FROM effect_ledger WHERE run_id=?').get(id)?.state).toBe('completed')
  expect(f.dispatcher.runs.get(id).automaticRecovery?.disposition).toBe('isolated')
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
  if (status === 'blocked') expect(f.dispatcher.runs.get(id).automaticRecovery).toMatchObject({ cause: 'permission', disposition: 'isolated' })
  else expect(f.dispatcher.runs.get(id).automaticRecovery).toBeUndefined()
})

it.each([
  [AuthorityError, 'authority', 'isolated'],
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

it('does not let a fenced worker record the root completion', async () => {
  const f = fixture()
  const run = f.dispatcher.runs.reserve(f.pod.id, f.store.getPod(f.pod.id).activeScript!, f.resources.epoch(f.pod.id)).run
  const authority = { source: 'owner-activation' as const, activationId: 'fence-fixture', podId: f.pod.id, scriptHash: run.scriptHash, assignmentRevision: f.pod.bindingRevision, resourceEpoch: f.resources.epoch(f.pod.id) }
  await executeOwnerScript(f.dispatcher.runs, run.id, authority, async (observer) => {
    await observer.authorized({ authority, write: false })
    f.store.db.prepare('UPDATE run_leases SET boot_id=? WHERE run_id=?').run('fenced-worker', run.id)
    await expect(observer.completed!({ exitCode: 0 })).rejects.toThrow('no longer owned')
  })
  expect(f.store.db.prepare('SELECT count(*) AS n FROM run_events WHERE run_id=? AND type=\'root-script\' AND json_extract(data,\'$.state\')=\'completed\'').get(run.id)!.n).toBe(0)
})
