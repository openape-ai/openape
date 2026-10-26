import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dispatch, normalizeJob, status } from '../src/codex/handoff'
import { digest, publishRecord } from '../src/codex/records'
import type { Job, Rpc } from '../src/codex/contract'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'codex-handoff-'))
  roots.push(root)
  const job = await normalizeJob({ schema: 'openape.codex-job/1', key: 'fixture', cwd: root, model: 'fixture-model', sandbox: 'danger-full-access', approvalPolicy: 'never', prompt: 'Write one harmless marker', maxAgeSeconds: 60 })
  const effective = { thread: { id: 'thread-1' }, model: job.model, cwd: job.cwd, sandbox: { type: 'dangerFullAccess' }, approvalPolicy: 'never' }
  const turn = { id: 'turn-1', status: 'completed', items: [{ type: 'userMessage', content: [{ type: 'text', text: `[OpenApe job ${digest(job)}]\n${job.prompt}` }] }] }
  const call = vi.fn(async (method: string) => {
    if (method === 'thread/start') return effective
    if (method === 'turn/start') return { turn }
    return { thread: { id: 'thread-1', cwd: job.cwd, turns: [turn] } }
  })
  const rpc: Rpc = { call, close: vi.fn() }
  return { root, job, rpc, call, effective, turn }
}

describe('Codex handoff effect boundaries', () => {
  it('dispatches once under concurrent callers and unchanged repeats', async () => {
    const f = await fixture()
    await Promise.all(Array.from({ length: 8 }, () => dispatch(f.root, f.job, f.rpc)))
    const repeat = await dispatch(f.root, f.job, f.rpc)
    expect(repeat).toMatchObject({ state: 'completed', skipped: true, threadId: 'thread-1', turnId: 'turn-1' })
    expect(f.call.mock.calls.filter(([method]) => method === 'thread/start')).toHaveLength(1)
    expect(f.call.mock.calls.filter(([method]) => method === 'turn/start')).toHaveLength(1)
  })
  it('rejects a changed prompt or execution configuration under the same key', async () => {
    const f = await fixture()
    await dispatch(f.root, f.job, f.rpc)
    for (const patch of [{ prompt: 'Other effects' }, { model: 'other' }, { sandbox: 'read-only' }]) {
      await expect(dispatch(f.root, { ...f.job, ...patch } as Job, f.rpc)).rejects.toThrow('conflict')
    }
    expect(f.call.mock.calls.filter(([method]) => method === 'thread/start')).toHaveLength(1)
  })
  it('never starts a turn after effective configuration mismatch', async () => {
    const f = await fixture()
    f.effective.sandbox.type = 'readOnly'
    expect(await dispatch(f.root, f.job, f.rpc)).toMatchObject({ state: 'blocked', phase: 'configuration' })
    expect(await dispatch(f.root, f.job, f.rpc)).toMatchObject({ state: 'blocked' })
    expect(f.call.mock.calls.some(([method]) => method === 'turn/start')).toBe(false)
  })
  it('never repeats a thread start whose response was lost after acceptance', async () => {
    const f = await fixture()
    f.call.mockRejectedValueOnce(new Error('Response lost after daemon acceptance'))
    expect(await dispatch(f.root, f.job, f.rpc)).toMatchObject({ state: 'unknown', phase: 'thread/start' })
    expect(await dispatch(f.root, f.job, f.rpc)).toMatchObject({ state: 'unknown', skipped: true })
    expect(f.call).toHaveBeenCalledTimes(1)
  })
  it('reconciles a lost turn response by exact message identity without starting again', async () => {
    const f = await fixture()
    f.call.mockImplementationOnce(async () => f.effective).mockRejectedValueOnce(new Error('Lost turn response'))
    expect(await dispatch(f.root, f.job, f.rpc)).toMatchObject({ state: 'unknown', phase: 'turn/start' })
    expect(await status(f.root, f.job, f.rpc)).toMatchObject({ state: 'completed', reconciled: true, turnId: 'turn-1' })
    expect(await dispatch(f.root, f.job, f.rpc)).toMatchObject({ state: 'completed', skipped: true })
    expect(f.call.mock.calls.filter(([method]) => method === 'turn/start')).toHaveLength(1)
  })
  it('does not adopt an unrelated or ambiguous turn', async () => {
    const f = await fixture()
    f.call.mockImplementationOnce(async () => f.effective).mockRejectedValueOnce(new Error('Lost turn response'))
    await dispatch(f.root, f.job, f.rpc)
    f.turn.items[0]!.content[0]!.text = 'Other user request'
    expect(await status(f.root, f.job, f.rpc)).toMatchObject({ state: 'unknown' })
  })
  it('distinguishes stale, interrupted and failed from completion', async () => {
    const f = await fixture()
    await publishRecord(join(f.root, digest(f.job.key)), 'intent', { schema: 'openape.codex-receipt/1', digest: digest(f.job), job: f.job, requestedAt: new Date(Date.now() - 120000).toISOString(), settleBy: new Date(Date.now() - 60000).toISOString() })
    await publishRecord(join(f.root, digest(f.job.key)), 'thread', f.effective)
    for (const [raw, expected] of [['inProgress', 'stale'], ['interrupted', 'interrupted'], ['failed', 'failed']]) {
      f.turn.status = raw!
      expect(await status(f.root, f.job, f.rpc)).toMatchObject({ state: expected })
    }
  })
})

it('distinguishes an unsettled intent from elapsed or explicitly failed dispatch', async () => {
  for (const scenario of ['future', 'elapsed', 'failure']) {
    const f = await fixture()
    const folder = join(f.root, digest(f.job.key))
    await publishRecord(folder, 'intent', { schema: 'openape.codex-receipt/1', digest: digest(f.job), job: f.job, requestedAt: new Date().toISOString(), settleBy: new Date(Date.now() + (scenario === 'elapsed' ? -60000 : 60000)).toISOString() })
    if (scenario === 'failure') await publishRecord(folder, 'failure', { reason: 'response lost' })
    expect(await status(f.root, f.job, f.rpc)).toMatchObject({ state: scenario === 'future' ? 'dispatching' : 'unknown' })
    await publishRecord(folder, 'thread', f.effective)
    f.turn.items = []
    expect(await status(f.root, f.job, f.rpc)).toMatchObject({ state: scenario === 'future' ? 'dispatching' : 'unknown' })
    expect(f.call.mock.calls.some(([method]) => method === 'turn/start')).toBe(false)
  }
})

it('refuses two matching turns without persisting an arbitrary identity', async () => {
  const f = await fixture()
  f.call.mockImplementationOnce(async () => f.effective).mockRejectedValueOnce(new Error('Lost response'))
  await dispatch(f.root, f.job, f.rpc)
  f.call.mockResolvedValueOnce({ thread: { id: 'thread-1', cwd: f.job.cwd, turns: [f.turn, { ...f.turn, id: 'turn-2' }] } })
  expect(await status(f.root, f.job, f.rpc)).toMatchObject({ state: 'unknown' })
  const { readRecord } = await import('../src/codex/records')
  expect(await readRecord(join(f.root, digest(f.job.key)), 'turn')).toBeUndefined()
  expect(f.call.mock.calls.filter(([method]) => method === 'turn/start')).toHaveLength(1)
})

it('refuses a public or linked receipt directory before any dispatch', async () => {
  const f = await fixture()
  const { chmod, symlink } = await import('node:fs/promises')
  await chmod(f.root, 0o755)
  await expect(dispatch(f.root, f.job, f.rpc)).rejects.toThrow('Receipt directory')
  await chmod(f.root, 0o700)
  await symlink(f.root, join(f.root, 'link'))
  await expect(dispatch(join(f.root, 'link'), f.job, f.rpc)).rejects.toThrow('Receipt directory')
  expect(f.call).not.toHaveBeenCalled()
})

it('keeps the returned thread identity when response schema changes', async () => {
  const f = await fixture()
  f.call.mockResolvedValueOnce({ thread: { id: 'accepted-thread' }, model: null })
  expect(await dispatch(f.root, f.job, f.rpc)).toMatchObject({ state: 'unknown', phase: 'thread/start', threadId: 'accepted-thread' })
  expect(f.call.mock.calls.some(([method]) => method === 'turn/start')).toBe(false)
})
