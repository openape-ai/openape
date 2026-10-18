// @vitest-environment node
import { Duplex } from 'node:stream'
import { expect, it, vi } from 'vitest'
import { observeExecution } from '../../src/main/programs/execution'
import type { ExecutionObserver } from '../../src/main/programs/execution'
import type { ProcessDomain } from '../../src/worker/runtime/sandbox'
import { AuthorityError, InfrastructureError, NonRetryableError, PermissionUnavailableError } from '../../src/contracts/infrastructure'

const authority = { source: 'owner-activation' as const, activationId: 'fixture:1', podId: '00000000-0000-4000-8000-000000000001', scriptHash: 'a'.repeat(64), assignmentRevision: 1, resourceEpoch: 0 }
function lifecycle(frames: object[], exitCode: number) {
  const acknowledgements: object[] = []
  const channel = new Duplex({ read() {}, write(bytes, _encoding, done) { acknowledgements.push(JSON.parse(String(bytes))); done() } })
  const domain = { authority: channel, completed: Promise.resolve(exitCode), cancel: vi.fn() } as unknown as ProcessDomain
  for (const frame of frames) channel.push(`${JSON.stringify({ version: 1, operationId: 'operation', ...frame })}\n`)
  channel.push(null)
  return { domain, acknowledgements }
}
const completion = (exitCode = 0) => [{ state: 'starting' }, { state: 'started', pid: 123 }, { state: 'completed', exitCode }]

it('acknowledges the exact owner activation only after durable observation and verifies nonzero completion', async () => {
  const f = lifecycle([{ state: 'authorized', authority, write: false }, ...completion(1)], 1)
  const completed = vi.fn(async () => {})
  const observer: ExecutionObserver = { authorized: async (receipt) => { expect(f.acknowledgements).toEqual([]); expect(receipt).toEqual({ authority, write: false }) }, completed }
  expect(await observeExecution(f.domain, 'operation', observer, new AbortController().signal, authority)).toEqual({ kind: 'completed', exitCode: 1 })
  expect(f.acknowledgements).toEqual([{ version: 1, operationId: 'operation', state: 'execute' }])
  expect(completed).toHaveBeenCalledWith({ exitCode: 1 })
})

it.each([
  { state: 'authorized', authority: { ...authority, scriptHash: 'b'.repeat(64) }, write: false },
  { state: 'authorized', authority, grantId: 'fake-root-grant', write: false },
  { state: 'pending', grantId: 'root', approvalUrl: 'https://id.example.test/root' },
])('never acknowledges a foreign or grant-backed owner receipt %#', async (frame) => {
  const f = lifecycle([frame], 1); const authorized = vi.fn()
  await expect(observeExecution(f.domain, 'operation', { authorized }, new AbortController().signal, authority)).rejects.toThrow()
  expect(authorized).not.toHaveBeenCalled(); expect(f.acknowledgements).toEqual([])
})

it.each([
  [{ kind: 'permission', state: 'denied' }, PermissionUnavailableError],
  [{ kind: 'infrastructure', phase: 'authorization', retryAfterMs: 1000, status: 503 }, InfrastructureError],
  [{ kind: 'permission', state: 'made-up' }, AuthorityError],
  [undefined, AuthorityError],
])('classifies only trusted pre-dispatch failure metadata %#', async (failure, errorClass) => {
  const f = lifecycle([{ state: 'not-started', error: 'Synthetic refusal', failure }], 1); const notStarted = vi.fn(async () => {})
  await expect(observeExecution(f.domain, 'operation', { authorized: vi.fn(), notStarted }, new AbortController().signal)).rejects.toBeInstanceOf(errorClass)
  expect(notStarted).toHaveBeenCalledOnce(); expect(f.acknowledgements).toEqual([])
})

it('keeps a missing or mismatched root completion unverified', async () => {
  const completed = vi.fn(async () => {})
  const f = lifecycle([{ state: 'authorized', authority, write: false }, ...completion()], 1)
  await expect(observeExecution(f.domain, 'operation', { authorized: async () => {}, completed }, new AbortController().signal, authority)).rejects.toBeInstanceOf(NonRetryableError)
  expect(completed).not.toHaveBeenCalled()
})
