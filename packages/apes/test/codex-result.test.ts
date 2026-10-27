import { createHash } from 'node:crypto'
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCommand } from 'citty'
import { afterEach, expect, it, vi } from 'vitest'
import { codexCommand } from '../src/commands/codex/index'
import { dispatch, normalizeJob, status } from '../src/codex/handoff'
import { connect } from '../src/codex/rpc'
import { recordApproval, requireApproval } from '../src/codex/approval'
import { digest } from '../src/codex/records'

vi.mock('../src/codex/rpc', () => ({ connect: vi.fn() }))
const roots: string[] = []
afterEach(async () => {
  process.exitCode = 0
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.clearAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'codex-result-'))
  roots.push(root)
  const job = await normalizeJob({ schema: 'openape.codex-job/1', key: 'result-test', cwd: root, model: 'fixture', sandbox: 'read-only', approvalPolicy: 'never', prompt: 'Return evidence', maxAgeSeconds: 60 })
  const turn: { id: string, status: string, itemsView: string, items: unknown[] } = {
    id: 'turn',
    status: 'completed',
    itemsView: 'full',
    items: [
      { type: 'agentMessage', id: 'commentary', phase: 'commentary', text: 'Working' },
      { type: 'agentMessage', id: 'final', phase: 'final_answer', text: '{"answer":"ä"}' },
    ],
  }
  const rpc = {
    close: vi.fn(),
    call: vi.fn(async (method: string) => {
      if (method === 'thread/start') return { thread: { id: 'thread' }, model: job.model, cwd: job.cwd, approvalPolicy: 'never', sandbox: { type: 'readOnly' } }
      if (method === 'turn/start') return { turn }
      return { thread: { id: 'thread', cwd: job.cwd, turns: [turn] } }
    }),
  }
  return { root, job, turn, rpc }
}

it('returns exact final answer bytes and digest from the identified complete turn', async () => {
  const f = await fixture()
  await dispatch(f.root, f.job, f.rpc)
  const result = await status(f.root, f.job, f.rpc, { result: true })
  expect(result).toMatchObject({ state: 'completed', result: { itemId: 'final', text: '{"answer":"ä"}', sha256: createHash('sha256').update('{"answer":"ä"}').digest('hex') } })
  expect(await status(f.root, f.job, f.rpc)).not.toHaveProperty('result')
  expect(f.rpc.call.mock.calls.filter(([method]) => method.endsWith('/start'))).toHaveLength(2)
})

it.each(['partial', 'missing', 'ambiguous', 'oversized', 'invalid'])('refuses %s final output without another dispatch', async (scenario) => {
  const f = await fixture()
  await dispatch(f.root, f.job, f.rpc)
  if (scenario === 'partial') f.turn.itemsView = 'notLoaded'
  if (scenario === 'missing') f.turn.items.pop()
  if (scenario === 'ambiguous') f.turn.items.push(f.turn.items[1])
  if (scenario === 'oversized') f.turn.items[1] = { type: 'agentMessage', phase: 'final_answer', id: 'final', text: 'ä'.repeat(131073) }
  if (scenario === 'invalid') f.turn.items[1] = { type: 'agentMessage', phase: 'final_answer', text: 42 }
  expect(await status(f.root, f.job, f.rpc, { result: true })).toMatchObject({ state: 'unknown', phase: 'result' })
  expect(f.rpc.call.mock.calls.filter(([method]) => method.endsWith('/start'))).toHaveLength(2)
})

it('does not expose a final-looking message while the turn is still running', async () => {
  const f = await fixture()
  await dispatch(f.root, f.job, f.rpc)
  f.turn.status = 'inProgress'
  const result = await status(f.root, f.job, f.rpc, { result: true })
  expect(result.state).toBe('inProgress')
  expect(result).not.toHaveProperty('result')
})

it.each(['dispatch', 'approve'])('blocks an unexpected job digest in %s before socket access or intent publication', async (operation) => {
  const f = await fixture()
  const file = join(f.root, 'job.json')
  await writeFile(file, JSON.stringify(f.job))
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  await runCommand(codexCommand, { rawArgs: [operation, '--job', file, '--receipts', f.root, '--expected-digest', '0'.repeat(64)] })
  expect(connect).not.toHaveBeenCalled()
  expect(process.exitCode).toBe(2)
  expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({ state: 'blocked', phase: 'digest' })
  expect(await readdir(f.root)).toEqual(['job.json'])
})

it('preserves an approval receipt after lost stdout and unchanged repeats', async () => {
  const f = await fixture()
  const expiresAt = new Date(Date.now() + 60000).toISOString()
  const first = await recordApproval(f.root, f.job, 'exact-reference', expiresAt)
  const file = join(f.root, digest(f.job), 'approval.json')
  const before = await stat(file)
  expect(await recordApproval(f.root, f.job, 'exact-reference', expiresAt)).toEqual(first)
  expect((await stat(file)).mtimeMs).toBe(before.mtimeMs)
  expect(await requireApproval(f.root, f.job)).toEqual(first)
  await expect(recordApproval(f.root, f.job, 'renewed-reference', expiresAt)).rejects.toThrow('conflict')
  expect(await requireApproval(f.root, f.job)).toEqual(first)
})

it('refuses changed effects and expiry without opening the daemon socket', async () => {
  const f = await fixture()
  const file = join(f.root, 'job.json')
  await recordApproval(f.root, f.job, 'exact-reference', new Date(Date.now() + 60000).toISOString())
  await writeFile(file, JSON.stringify({ ...f.job, prompt: 'Different effects' }))
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  await runCommand(codexCommand, { rawArgs: ['dispatch', '--job', file, '--receipts', f.root, '--approval-root', f.root] })
  expect(connect).not.toHaveBeenCalled()
  expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({ state: 'blocked', phase: 'approval' })
  const receipt = await requireApproval(f.root, f.job)
  await writeFile(join(f.root, digest(f.job), 'approval.json'), JSON.stringify({ ...receipt, expiresAt: new Date(Date.now() - 1000).toISOString() }))
  await expect(requireApproval(f.root, f.job)).rejects.toThrow('expired')
  await expect(recordApproval(f.root, { ...f.job, key: 'expired-new-job' }, 'expired', new Date(Date.now() - 1000).toISOString())).rejects.toThrow('expired')
})

it('records an exact authorized approval effect without connecting or dispatching', async () => {
  const f = await fixture()
  const file = join(f.root, 'job.json')
  await writeFile(file, JSON.stringify(f.job))
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  await runCommand(codexCommand, { rawArgs: ['approve', '--job', file, '--receipts', f.root, '--expected-digest', digest(f.job), '--reference', 'fixture-reference', '--expires-at', new Date(Date.now() + 60000).toISOString()] })
  expect(connect).not.toHaveBeenCalled()
  expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({ state: 'recorded', receipt: { jobDigest: digest(f.job), reference: 'fixture-reference' } })
  expect(await readdir(join(f.root, digest(f.job)))).toEqual(['approval.json'])
})

it('starts an approved job once and observes it after the approval expires', async () => {
  const f = await fixture()
  const file = join(f.root, 'job.json')
  await writeFile(file, JSON.stringify(f.job))
  const expiresAt = new Date(Date.now() + 60000).toISOString()
  await recordApproval(f.root, f.job, 'exact-reference', expiresAt)
  vi.mocked(connect).mockResolvedValue(f.rpc)
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  const args = ['dispatch', '--job', file, '--receipts', f.root, '--approval-root', f.root]
  await runCommand(codexCommand, { rawArgs: args })
  expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({ state: 'completed', skipped: false })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.parse(expiresAt) + 1000)
  await runCommand(codexCommand, { rawArgs: args })
  expect(JSON.parse(String(output.mock.calls[1]?.[0]))).toMatchObject({ state: 'completed', skipped: true })
  await runCommand(codexCommand, { rawArgs: ['status', '--job', file, '--receipts', f.root, '--result'] })
  expect(JSON.parse(String(output.mock.calls[2]?.[0]))).toMatchObject({ state: 'completed', result: { itemId: 'final' } })
  expect(f.rpc.call.mock.calls.filter(([method]) => method.endsWith('/start'))).toHaveLength(2)
})

it('recovers an expired recorded approval without renewing its authority', async () => {
  const f = await fixture()
  const expiresAt = new Date(Date.now() + 60000).toISOString()
  const receipt = await recordApproval(f.root, f.job, 'exact-reference', expiresAt)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(Date.parse(expiresAt) + 1000)
  expect(await recordApproval(f.root, f.job, 'exact-reference', expiresAt)).toEqual(receipt)
  await expect(requireApproval(f.root, f.job)).rejects.toThrow('expired')
})

it('rechecks approval after a delayed connection before writing an intent', async () => {
  const f = await fixture()
  const file = join(f.root, 'job.json')
  await writeFile(file, JSON.stringify(f.job))
  const expiresAt = new Date(Date.now() + 60000).toISOString()
  await recordApproval(f.root, f.job, 'exact-reference', expiresAt)
  vi.mocked(connect).mockImplementation(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.parse(expiresAt) + 1000)
    return f.rpc
  })
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  await runCommand(codexCommand, { rawArgs: ['dispatch', '--job', file, '--receipts', f.root, '--approval-root', f.root] })
  expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({ state: 'blocked', phase: 'approval' })
  expect(f.rpc.call).not.toHaveBeenCalled()
  expect(await readdir(f.root)).not.toContain(digest(f.job.key))
})

it.each(['unknown-view', 'invalid-unicode'])('refuses %s output', async (scenario) => {
  const f = await fixture()
  await dispatch(f.root, f.job, f.rpc)
  if (scenario === 'unknown-view') f.turn.itemsView = ''
  else f.turn.items[1] = { type: 'agentMessage', id: 'final', phase: 'final_answer', text: '\uD800' }
  expect(await status(f.root, f.job, f.rpc, { result: true })).toMatchObject({ state: 'unknown', phase: 'result' })
})

it('computes canonical job identity without a receipt root, connection or write', async () => {
  const f = await fixture()
  const file = join(f.root, 'job.json')
  await writeFile(file, JSON.stringify(f.job))
  const output = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  await runCommand(codexCommand, { rawArgs: ['digest', '--job', file] })
  expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toEqual({ schema: 'openape.codex-identity/1', key: f.job.key, cwd: f.job.cwd, digest: digest(f.job) })
  expect(connect).not.toHaveBeenCalled()
  expect(await readdir(f.root)).toEqual(['job.json'])
})

it('extracts only the recorded turn even when an unrelated turn has another final answer', async () => {
  const f = await fixture()
  await dispatch(f.root, f.job, f.rpc)
  f.rpc.call.mockResolvedValueOnce({ thread: { id: 'thread', cwd: f.job.cwd, turns: [f.turn, { ...f.turn, id: 'unrelated' }] } })
  expect(await status(f.root, f.job, f.rpc, { result: true })).toMatchObject({ state: 'completed', turnId: 'turn', result: { itemId: 'final' } })
})

it('records an expiry before thread/start as blocked and never retries that intent', async () => {
  const f = await fixture()
  const expiresAt = new Date(Date.now() + 60000).toISOString()
  await recordApproval(f.root, f.job, 'exact-reference', expiresAt)
  const records = await import('../src/codex/records')
  const publish = records.publishRecord
  vi.spyOn(records, 'publishRecord').mockImplementation(async (...args) => {
    const result = await publish(...args)
    if (args[1] === 'intent') {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(Date.parse(expiresAt) + 1000)
    }
    return result
  })
  expect(await dispatch(f.root, f.job, f.rpc, { approvalRoot: f.root })).toMatchObject({ state: 'blocked', phase: 'approval' })
  expect(await dispatch(f.root, f.job, f.rpc, { approvalRoot: f.root })).toMatchObject({ state: 'blocked', phase: 'approval', skipped: true })
  expect(f.rpc.call).not.toHaveBeenCalled()
})
