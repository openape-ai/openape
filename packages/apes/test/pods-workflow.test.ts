import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { approval, handoff, read, save, stage } from '../src/pods/index'
import type { Tools } from '../src/pods/invoke'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pod-workflow-')); roots.push(root)
  await mkdir(join(root, 'receipts'))
  const digest = 'a'.repeat(64)
  const input = { application: 'fixture', root, output: join(root, 'decision.json'), jobFile: join(root, 'job.json'), job: { prompt: 'fixture' }, expectedDigest: digest, referencePrefix: 'test-', metadata: { workflowId: digest }, summary: () => ({ title: 'Fixture', description: 'No product action', link: 'https://example.invalid' }) }
  return { root, digest, input }
}
it('recovers a lost approval response from its receipt without another approval invocation', async () => {
  const { root, digest, input } = await fixture()
  const tools: Tools = {
    withdraw: vi.fn(),
    invoke: vi.fn(async (request) => {
      const argv = request.argv as string[]
      if (argv[0] === 'digest') return { exitCode: 0, stdout: JSON.stringify({ digest }) }
      await save(join(root, 'receipts', digest, 'approval.json'), { jobDigest: digest, reference: `test-${digest}`, expiresAt: argv.at(-1) })
      throw new Error('Lost response after the authorized receipt was published')
    }),
  }
  await expect(approval(tools, input)).rejects.toThrow('Lost response')
  expect((await approval(tools, input)).status).toBe('approved')
  expect((tools.invoke as ReturnType<typeof vi.fn>).mock.calls.filter(([request]) => request.argv[0] === 'approve')).toHaveLength(1)
})
it('withdraws an expired pending approval without invoking its effect', async () => {
  const { digest, input } = await fixture()
  await save(input.output, { status: 'pending', jobDigest: digest, reference: `test-${digest}`, expiresAt: '2000-01-01T00:00:00.000Z' })
  const tools: Tools = { withdraw: vi.fn(), invoke: vi.fn(async () => ({ exitCode: 0, stdout: JSON.stringify({ digest }) })) }
  expect((await approval(tools, input)).status).toBe('expired')
  expect(tools.invoke).toHaveBeenCalledTimes(1)
  expect(tools.withdraw).toHaveBeenCalledTimes(1)
})
it('never accepts changed job content under an existing approved identity', async () => {
  const { input } = await fixture()
  await save(input.jobFile, input.job)
  await save(input.output, { status: 'approved' })
  const tools: Tools = { withdraw: vi.fn(), invoke: vi.fn() }
  await expect(approval(tools, { ...input, job: { prompt: 'different effect' } })).rejects.toThrow('Immutable input changed')
  expect(tools.invoke).not.toHaveBeenCalled()
})
it('reconciles an unknown job on the same paths and preserves operation/cause without leaking a token', async () => {
  const { root, input } = await fixture()
  const tools: Tools = { withdraw: vi.fn(), invoke: vi.fn(async () => ({ exitCode: 2, stdout: JSON.stringify({ state: 'unknown', phase: 'thread/read', reason: 'Connection failed with token=fixture-secret' }) })) }
  const output = join(root, 'result.json')
  const attempt = () => stage(output, { stage: 'planning' }, () => handoff(tools, { ...input, receipts: join(root, 'receipts') }))
  await attempt(); await attempt()
  expect(tools.invoke).toHaveBeenCalledTimes(2)
  expect((tools.invoke as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual((tools.invoke as ReturnType<typeof vi.fn>).mock.calls[1])
  expect(await read(output)).toMatchObject({ status: 'unknown', phase: 'thread/read', terminal: false })
  expect(await readFile(output, 'utf8')).not.toContain('fixture-secret')
})
it('retains failed final answers without another dispatch and distinguishes pending from completed', async () => {
  const { root, input } = await fixture()
  const tools: Tools = { withdraw: vi.fn(), invoke: vi.fn(async request => ({ exitCode: 0, stdout: JSON.stringify((request.argv as string[])[0] === 'dispatch' ? { state: 'completed' } : { state: 'completed', result: { sha256: 'b'.repeat(64), text: JSON.stringify({ status: 'failed', operation: 'plan/review', cause: 'Reviewer unavailable' }) } }) })) }
  const output = join(root, 'result.json')
  const attempt = () => stage(output, {}, () => handoff(tools, { ...input, receipts: join(root, 'receipts') }))
  await attempt(); await attempt()
  expect(tools.invoke).toHaveBeenCalledTimes(2)
  expect(await read(output)).toMatchObject({ status: 'failed', terminal: true, phase: 'plan/review' })
})
it('does not treat a dispatching exit as a failed or finished job', async () => {
  const { root, input } = await fixture()
  const tools: Tools = { withdraw: vi.fn(), invoke: vi.fn(async () => ({ exitCode: 3, stdout: '{"state":"dispatching"}' })) }
  expect(await handoff(tools, { ...input, receipts: join(root, 'receipts') })).toMatchObject({ state: 'running' })
})

it('a direct-start transport loss keeps the exact request and recovers its intent without another start', async () => {
  const { root, input } = await fixture()
  const { requestStart, jobIdentity } = await import('../src/pods/start')
  const { digest } = await import('../src/codex/records')
  const job = { schema: 'openape.codex-job/1', key: 'direct-fixture', cwd: root, model: 'fixture', sandbox: 'read-only', approvalPolicy: 'never', prompt: 'Harmless infrastructure verification', maxAgeSeconds: 60 }
  const identity = await jobIdentity(job)
  const direct = { ...input, job, jobFile: join(root, 'b'.repeat(64), 'job.json'), expectedDigest: identity.digest, metadata: { workflowId: 'b'.repeat(64) } }
  const tools: Tools = {
    withdraw: vi.fn(),
    invoke: vi.fn(async (request) => {
      const argv = request.argv as string[]
      expect(argv[0]).toBe('dispatch')
      const receiptRoot = argv[argv.indexOf('--receipts') + 1]!
      await save(join(receiptRoot, digest(job.key), 'intent.json'), { digest: identity.digest, startApproval: { reference: argv[argv.indexOf('--reference') + 1], deadline: argv[argv.indexOf('--deadline') + 1] } })
      throw new Error('Synthetic lost start response')
    }),
  }
  await expect(requestStart(tools, direct)).rejects.toMatchObject({ status: 'unknown', terminal: false })
  expect(await requestStart(tools, direct)).toMatchObject({ status: 'approved', authorization: 'exact-start' })
  expect(tools.invoke).toHaveBeenCalledTimes(1)
})
it('a lost mutable output retains the original exact-start expiry and does not invent another approval', async () => {
  const { root, input } = await fixture()
  const { requestStart } = await import('../src/pods/start')
  const job = { schema: 'openape.codex-job/1', key: 'pending-fixture', cwd: root, model: 'fixture', sandbox: 'read-only', approvalPolicy: 'never', prompt: 'Harmless fixture', maxAgeSeconds: 60 }
  const direct = { ...input, job, jobFile: join(root, 'c'.repeat(64), 'job.json'), expectedDigest: undefined, metadata: { workflowId: 'c'.repeat(64) } }
  const tools: Tools = { withdraw: vi.fn(), invoke: vi.fn(async () => ({ pending: { grantId: 'fixture', approvalUrl: 'https://example.invalid' } })) }
  await requestStart(tools, direct)
  await rm(input.output)
  await requestStart(tools, direct)
  const calls = (tools.invoke as ReturnType<typeof vi.fn>).mock.calls
  expect(calls[0]).toEqual(calls[1])
})
it('rejects a queued job digest mismatch and traversal before any daemon call', async () => {
  const { root } = await fixture()
  const { queueJob } = await import('../src/codex/queue')
  const id = 'd'.repeat(64)
  await save(join(root, id, 'job.json'), { schema: 'openape.codex-job/1', key: 'queue-fixture', cwd: root, model: 'fixture', sandbox: 'read-only', approvalPolicy: 'never', prompt: 'Fixture', maxAgeSeconds: 60 })
  await save(join(root, 'query.json'), { id, digest: 'f'.repeat(64) })
  await expect(queueJob(root, root, join(root, 'query.json'), true)).rejects.toThrow('canonical digest')
  await save(join(root, 'query.json'), { id: '../escape', digest: 'f'.repeat(64) })
  await expect(queueJob(root, root, join(root, 'query.json'), true)).rejects.toThrow()
})

it('pins automatic queue execution settings and policy bytes before dispatch', async () => {
  const { root } = await fixture()
  const { checkQueuePolicy } = await import('../src/codex/queue')
  const { normalizeJob } = await import('../src/codex/handoff')
  const { createHash } = await import('node:crypto')
  const id = 'e'.repeat(64)
  const job = await normalizeJob({ schema: 'openape.codex-job/1', key: `fixture-${id}`, cwd: root, model: 'fixture', sandbox: 'read-only', approvalPolicy: 'never', prompt: 'Inspect JSON: {}', maxAgeSeconds: 60 })
  const path = join(root, 'policy.json')
  await save(path, { schema: 'openape.codex-queue-policy/1', cwd: root, model: job.model, sandbox: job.sandbox, approvalPolicy: job.approvalPolicy, keyPrefix: 'fixture-', keySuffix: '', promptPrefix: 'Inspect JSON: ', file: 'job.json', maxAgeSeconds: 60 })
  const pinned = createHash('sha256').update(await readFile(path)).digest('hex')
  await expect(checkQueuePolicy(job, id, 'job.json', path, pinned)).resolves.toBeUndefined()
  await expect(checkQueuePolicy({ ...job, sandbox: 'danger-full-access' }, id, 'job.json', path, pinned)).rejects.toThrow('owner-authorized execution policy')
  await save(path, { changed: true })
  await expect(checkQueuePolicy(job, id, 'job.json', path, pinned)).rejects.toThrow('policy changed')
})
it('withdraws a superseded unknown start using its immutable reference and preserves an already started job', async () => {
  const { root } = await fixture()
  const { supersede } = await import('../src/pods/supersede')
  const { digest } = await import('../src/codex/records')
  const input = { output: join(root, 'output.json'), jobFile: join(root, 'job.json'), executionRoot: join(root, 'receipts'), metadata: { workflowId: 'f'.repeat(64) } }
  await save(input.jobFile, { key: 'fixture' })
  await save(`${input.jobFile}.request.json`, { reference: 'immutable-fixture-reference', digest: 'a'.repeat(64), expiresAt: 'future' })
  await save(input.output, { status: 'unknown' })
  const tools: Tools = { invoke: vi.fn(), withdraw: vi.fn(async () => ({ outcome: 'withdrawn' })) }
  await supersede(tools, input)
  expect(tools.withdraw).toHaveBeenCalledWith(expect.objectContaining({ reference: 'immutable-fixture-reference' }))
  expect(await read(input.output)).toMatchObject({ status: 'withdrawn' })
  await save(input.output, { status: 'unknown' })
  await save(join(input.executionRoot, digest('fixture'), 'intent.json'), { digest: 'a'.repeat(64), startApproval: { reference: 'immutable-fixture-reference', deadline: 'future' } })
  await supersede(tools, input)
  expect(tools.withdraw).toHaveBeenCalledTimes(1)
  expect(await read(input.output)).toMatchObject({ status: 'approved', superseded: true })
})

it('records a failed withdrawal without aborting other workflow processing', async () => {
  const { root } = await fixture()
  const { supersede } = await import('../src/pods/supersede')
  const input = { output: join(root, 'output.json'), jobFile: join(root, 'job.json'), executionRoot: join(root, 'receipts'), metadata: { workflowId: 'f'.repeat(64) } }
  await save(`${input.jobFile}.request.json`, { reference: 'fixture' })
  const tools: Tools = { invoke: vi.fn(), withdraw: vi.fn(async () => { throw new Error('Temporary connection failure') }) }
  await expect(supersede(tools, input)).resolves.toBeUndefined()
  expect(await read(input.output)).toMatchObject({ status: 'unknown', phase: 'approval/withdraw', terminal: false })
})
it('rechecks an intent created during withdrawal and does not mark a failed start approved', async () => {
  const { root } = await fixture()
  const { supersede } = await import('../src/pods/supersede')
  const { digest } = await import('../src/codex/records')
  const input = { output: join(root, 'output.json'), jobFile: join(root, 'job.json'), executionRoot: join(root, 'receipts'), metadata: {} }
  await save(input.jobFile, { key: 'fixture' })
  await save(`${input.jobFile}.request.json`, { reference: 'fixture', digest: 'a'.repeat(64), expiresAt: 'future' })
  const folder = join(input.executionRoot, digest('fixture'))
  const tools: Tools = {
    invoke: vi.fn(),
    withdraw: vi.fn(async () => {
      await save(join(folder, 'intent.json'), { digest: 'a'.repeat(64), startApproval: { reference: 'fixture', deadline: 'future' } })
      return { outcome: 'alreadyDecided', state: 'used' }
    }),
  }
  await supersede(tools, input)
  expect(await read(input.output)).toMatchObject({ status: 'approved', superseded: true })
  await save(join(folder, 'failure.json'), { phase: 'approval', cause: 'Deadline expired before thread/start' })
  await supersede(tools, input)
  expect(await read(input.output)).toMatchObject({ status: 'failed', phase: 'approval/start', terminal: true })
  expect(tools.withdraw).toHaveBeenCalledTimes(1)
})

it('does not inherit terminal readiness metadata into a pending approval', async () => {
  const { root, input } = await fixture()
  const { requestStart } = await import('../src/pods/start')
  const job = { schema: 'openape.codex-job/1', key: 'terminal-metadata-fixture', cwd: root, model: 'fixture', sandbox: 'read-only', approvalPolicy: 'never', prompt: 'Fixture', maxAgeSeconds: 60 }
  const direct = { ...input, job, jobFile: join(root, 'a'.repeat(64), 'job.json'), expectedDigest: undefined, metadata: { workflowId: 'a'.repeat(64), terminal: true, status: 'completed' } }
  const tools: Tools = { withdraw: vi.fn(), invoke: vi.fn(async () => ({ pending: { grantId: 'fixture', approvalUrl: 'https://example.invalid' } })) }
  const attempt = () => stage(input.output, direct.metadata, () => requestStart(tools, direct))
  await attempt(); await attempt()
  expect(await read(input.output)).toMatchObject({ status: 'pending', terminal: false })
  expect(tools.invoke).toHaveBeenCalledTimes(2)
})
