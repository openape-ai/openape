// @vitest-environment node
import { createHash } from 'node:crypto'
import type { OpenApeGrantBatch } from '@openape/core'
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Duplex, PassThrough } from 'node:stream'
import { afterEach, expect, it, vi } from 'vitest'
import { PodToolBroker } from '../../src/main/broker/tools'
import type { ToolAssignment } from '../../src/main/broker/tools'
import { CredentialCache } from '../../src/main/connections/cache'
import { InfrastructureError, NonRetryableError } from '../../src/contracts/infrastructure'
import { launchApeShell } from '../../src/worker/runtime/ape-shell'

vi.mock('../../src/worker/runtime/ape-shell', () => ({ launchApeShell: vi.fn() }))
const roots: string[] = []
afterEach(async () => { vi.clearAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

async function invoke(frames: object[], options: { exitCode?: number, stdout?: string, batch?: OpenApeGrantBatch } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'pods-tool-refusal-'))); roots.push(root)
  const executable = await realpath(process.execPath)
  const hash = createHash('sha256').update(await readFile(executable)).digest('hex')
  const authorized = vi.fn(async () => {}); const notStarted = vi.fn(async () => {})
  const channel = new Duplex({ read() {}, write(_bytes, _encoding, done) { done() } })
  for (const frame of frames) channel.push(`${JSON.stringify({ version: 1, operationId: 'operation', ...frame })}\n`)
  channel.push(null)
  const stdout = new PassThrough(); const stderr = new PassThrough()
  vi.mocked(launchApeShell).mockImplementation(async () => {
    if (options.stdout) queueMicrotask(() => stdout.write(options.stdout!))
    return { stdout, stderr, authority: channel, processId: Promise.resolve(123), completed: Promise.resolve(options.exitCode ?? 1), cancel: vi.fn() } as never
  })
  const assignment: ToolAssignment = { id: 'application', identityConnection: { issuer: 'https://id.example.test', subject: 'pod@example.test', owner: 'owner@example.test', keyId: 'key', targetHost: 'pods:fixture', accessToken: async () => 'SYNTHETIC_POD_TOKEN' }, program: { path: executable, name: 'fixture', sha256: hash }, argv: ['read'], reach: { level: 'owner', protectedPaths: [] }, capability: 'tool.fixture.invoke', executable, executableHash: hash, entryFiles: [], prefix: [], runtimeDirectories: [], environment: {}, networkPorts: [], approvalWaitMs: 0 }
  const broker = new PodToolBroker('/unused/helper', root, { runtime: { executable, cli: '/unused/ape-shell.mjs' }, operationId: 'operation', targetHost: 'pods:fixture', batch: options.batch, observer: { authorized, notStarted } }, new CredentialCache(root))
  const result = broker.execute(assignment, { toolId: assignment.id, argv: assignment.argv }, { capabilities: [assignment.capability], assertCurrent: () => {}, signal: AbortSignal.timeout(5000) })
  return { result, authorized, notStarted }
}

it.each(['missing', 'pending', 'denied', 'revoked', 'expired'])('returns the verified %s decision without starting the target', async (state) => {
  const f = await invoke([{ state: 'not-started', error: 'Synthetic permission refusal', failure: { kind: 'permission', state, grantId: 'reviewed-grant' } }])
  expect(await f.result).toEqual({ exitCode: 126, stdout: '', stderr: '', refusal: { reason: 'Synthetic permission refusal', state, grantId: 'reviewed-grant' } })
  expect(f.authorized).not.toHaveBeenCalled(); expect(f.notStarted).toHaveBeenCalledOnce()
})

it('preserves an absent grant ID without inventing one', async () => {
  const f = await invoke([{ state: 'not-started', failure: { kind: 'permission', state: 'missing' } }])
  expect(await f.result).toMatchObject({ refusal: { state: 'missing' } })
  expect((await f.result).refusal).not.toHaveProperty('grantId')
})

it.each([
  { kind: 'permission', state: 'made-up', grantId: 'untrusted' },
  { kind: 'permission', state: ['denied'], grantId: 'untrusted' },
  { kind: 'permission', state: 'denied', grantId: '' },
  { kind: 'permission', state: 'denied', grantId: 'untrusted', extra: true },
])('does not present malformed lifecycle metadata as an owner decision %#', async (failure) => {
  const f = await invoke([{ state: 'not-started', error: 'Synthetic generic refusal', failure }])
  expect(await f.result).toEqual({ exitCode: 126, stdout: '', stderr: '', refusal: { reason: 'Synthetic generic refusal' } })
  expect(f.authorized).not.toHaveBeenCalled()
})

it('passes batch presentation to ape-shell as single-use and keeps pending separate from refusal', async () => {
  const batch = { id: 'selected-calls', title: 'Review selected calls', size: 2 }
  const f = await invoke([{ state: 'pending', grantId: 'waiting-grant', approvalUrl: 'https://id.example.test/approval' }], { exitCode: 75, batch })
  expect(await f.result).toEqual({ exitCode: 75, stdout: '', stderr: '', pending: { grantId: 'waiting-grant', approvalUrl: 'https://id.example.test/approval' } })
  expect(f.authorized).not.toHaveBeenCalled(); expect(f.notStarted).not.toHaveBeenCalled()
  expect(vi.mocked(launchApeShell).mock.calls[0]![5]).toMatchObject({ batch, grantType: 'once' })
})

it('keeps authorization infrastructure errors retryable instead of marking them denied', async () => {
  const f = await invoke([{ state: 'not-started', failure: { kind: 'infrastructure', phase: 'authorization', retryAfterMs: 1000, status: 503 } }])
  await expect(f.result).rejects.toBeInstanceOf(InfrastructureError)
  expect(f.authorized).not.toHaveBeenCalled()
})

it('never trusts a refusal printed to stdout without a private lifecycle receipt', async () => {
  const f = await invoke([], { stdout: JSON.stringify({ state: 'not-started', failure: { kind: 'permission', state: 'denied' } }) })
  await expect(f.result).rejects.toBeInstanceOf(NonRetryableError)
  expect(f.authorized).not.toHaveBeenCalled(); expect(f.notStarted).not.toHaveBeenCalled()
})

it('retains an unknown process outcome instead of returning a pre-dispatch refusal', async () => {
  const f = await invoke([{ state: 'authorized', grantId: 'approved-grant', write: true }, { state: 'starting' }, { state: 'started', pid: 123 }])
  await expect(f.result).rejects.toBeInstanceOf(NonRetryableError)
  expect(f.authorized).toHaveBeenCalledOnce(); expect(f.notStarted).not.toHaveBeenCalled()
})
