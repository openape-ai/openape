// @vitest-environment node
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, expect, it, vi } from 'vitest'
import { InfrastructureError, NonRetryableError, retryInfrastructure, transientNetwork, transientResponse } from '../src/contracts/infrastructure'
import { recoveryDecision } from '../src/worker/recovery/policy'
import { MailBridge } from '../src/worker/mail/bridge'

vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn() }))
afterEach(() => { vi.restoreAllMocks(); vi.mocked(delay).mockReset() })
const failure = () => new InfrastructureError({ phase: 'authorization', retryAfterMs: 0 })

it('survives a prolonged outage with capped backoff and resumes the same operation', async () => {
  let now = 0
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  vi.mocked(delay).mockImplementation(async (ms) => { now += Number(ms) })
  const notice = vi.fn()
  const operation = vi.fn()
  for (let attempt = 0; attempt < 10; attempt++) operation.mockRejectedValueOnce(failure())
  operation.mockResolvedValue('restored')
  await expect(retryInfrastructure(operation, new AbortController().signal, notice)).resolves.toBe('restored')
  expect(vi.mocked(delay).mock.calls.map(call => call[0])).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000, 60000, 60000])
  expect(notice).toHaveBeenLastCalledWith(null)
  expect(operation).toHaveBeenCalledTimes(11)
})
it('honors bounded Retry-After and never retries ordinary failures or owner cancellation', async () => {
  const notice = vi.fn()
  const error = (() => {
    try { transientResponse(new Response(null, { status: 429, headers: { 'retry-after': '120' } }), 'read') }
    catch (error) { return error }
  })()
  const operation = vi.fn().mockRejectedValueOnce(error).mockResolvedValue('ok')
  await retryInfrastructure(operation, new AbortController().signal, notice)
  expect(delay).toHaveBeenCalledWith(60000, undefined, { signal: expect.any(AbortSignal) })
  const refusal = vi.fn().mockRejectedValue(new Error('Permission revoked'))
  await expect(retryInfrastructure(refusal, new AbortController().signal, notice)).rejects.toThrow('revoked')
  expect(refusal).toHaveBeenCalledTimes(1)
  const controller = new AbortController()
  const cancelled = vi.fn().mockImplementation(async () => { controller.abort(new Error('Owner cancelled')); throw failure() })
  await expect(retryInfrastructure(cancelled, controller.signal, notice)).rejects.toThrow('Owner cancelled')
  expect(cancelled).toHaveBeenCalledTimes(1)
})
it('bounds preflight waiting so the caller can release its execution slot', async () => {
  let now = 0
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  vi.mocked(delay).mockImplementation(async (ms) => { now += Number(ms) })
  await expect(retryInfrastructure(async () => { throw failure() }, new AbortController().signal, () => {}, 30000)).rejects.toBeInstanceOf(InfrastructureError)
  expect(now).toBe(30000)
})
it('classifies temporary transport faults without treating refusal or invalid data as retryable', () => {
  expect(() => transientNetwork(new Error('fetch failed', { cause: { code: 'ECONNRESET' } }), 'authorization')).toThrow(InfrastructureError)
  expect(() => transientNetwork(new DOMException('expired', 'TimeoutError'), 'read')).toThrow(InfrastructureError)
  expect(() => transientNetwork(new Error('Invalid identity'), 'authorization')).toThrow('Invalid identity')
  for (const status of [400, 401, 403, 404, 409]) expect(() => transientResponse(new Response(null, { status }), 'authorization')).not.toThrow()
})
it('preserves trusted retry metadata through broker IPC without interpreting error text', async () => {
  const send = vi.fn()
  const bridge = new MailBridge(send)
  const scope = { podId: 'pod', runId: 'run', epoch: 0, assignmentRevision: 1, capabilities: [] }
  const work = bridge.execute(scope, {}, new AbortController().signal, 'http')
  const rejected = expect(work).rejects.toBeInstanceOf(InfrastructureError)
  bridge.accept({ id: send.mock.calls[0]![0].service.id, error: 'unavailable', infrastructure: failure().failure })
  await rejected
  const plain = bridge.execute(scope, {}, new AbortController().signal, 'http')
  const ordinary = expect(plain).rejects.not.toBeInstanceOf(InfrastructureError)
  bridge.accept({ id: send.mock.calls[1]![0].service.id, error: 'Permission service temporarily unavailable' })
  await ordinary
})

it('carries a non-retryable tool failure through broker IPC and never schedules a retry for it', async () => {
  const send = vi.fn()
  const bridge = new MailBridge(send)
  const scope = { podId: 'pod', runId: 'run', epoch: 0, assignmentRevision: 1, capabilities: [] }
  const work = bridge.execute(scope, {}, new AbortController().signal)
  const rejected = expect(work).rejects.toBeInstanceOf(NonRetryableError)
  bridge.accept({ id: send.mock.calls[0]![0].service.id, error: 'Tool output exceeded 200000 bytes; read smaller pages, for example with --limit', nonRetryable: true })
  await rejected
  expect(recoveryDecision({ cause: 'non-retryable' }, 0, null, 1000)).toMatchObject({ disposition: 'isolated', nextAt: null })
  expect(recoveryDecision({ cause: 'failure' }, 0, null, 1000)).toMatchObject({ disposition: 'retry' })
})
