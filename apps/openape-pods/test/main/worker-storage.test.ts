// @vitest-environment node
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { storageReadinessMs } from '../../src/contracts/storage'
import type { WorkerStatus } from '../../src/contracts/ipc'

const fork = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({ utilityProcess: { fork }, safeStorage: {}, app: { getPath: () => '/nonexistent' }, shell: { openExternal: vi.fn(async () => {}) } }))
vi.mock('../../src/main/support', () => ({ assertPilotRuntime: () => {} }))

class Child extends EventEmitter {
  pid = 4242
  stderr = new EventEmitter()
  postMessage = vi.fn()
  kill = vi.fn(() => { this.emit('exit', 15) })
}
const roots: string[] = []
afterEach(() => { vi.useRealTimers(); fork.mockReset(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
async function started() {
  const { FixtureWorker } = await import('../../src/main/worker')
  const published: WorkerStatus[] = []
  const worker = new FixtureWorker(status => published.push(structuredClone(status)))
  const children: Child[] = []
  fork.mockImplementation(() => { const child = new Child(); children.push(child); return child })
  const root = mkdtempSync(join(tmpdir(), 'pods-worker-storage-')); roots.push(root)
  worker.start(root, root)
  return { worker, published, children }
}

it('shows a classified recovery instead of an error, and never restarts the worker by itself', async () => {
  vi.useFakeTimers()
  const { published, children } = await started()
  children[0]!.emit('message', { storage: { reason: 'corrupt', message: 'Database integrity check failed', at: 1 } })
  children[0]!.emit('exit', 3)
  expect(published.at(-1)).toMatchObject({ state: 'recovery', storage: { reason: 'corrupt' } })
  await vi.advanceTimersByTimeAsync(storageReadinessMs * 4)
  expect(fork).toHaveBeenCalledTimes(1)
})

it('reports a storage open that does not finish in time and opens again only on request', async () => {
  vi.useFakeTimers()
  const { worker, published, children } = await started()
  await vi.advanceTimersByTimeAsync(storageReadinessMs - 1)
  expect(published.some(status => status.state === 'recovery')).toBe(false)
  await vi.advanceTimersByTimeAsync(2)
  expect(published.at(-1)).toMatchObject({ state: 'recovery', storage: { reason: 'timeout' } })
  await worker.retryStorage()
  expect(children[0]!.kill).toHaveBeenCalled()
  expect(fork).toHaveBeenCalledTimes(2)
})

it('passes the automatic backup directory beside the profile base to the worker', async () => {
  await started()
  const environment = fork.mock.calls[0]![2].env as Record<string, string>
  expect(environment.PODS_BACKUP_DIRECTORY).toMatch(/ Backups$/)
  expect(environment.PODS_BACKUP_DIRECTORY.startsWith(`${fork.mock.calls[0]![2].cwd as string}/`)).toBe(false)
})

it('keeps proxy cancellation acknowledgement available until the worker has drained shutdown', async () => {
  const { startAgentGateway } = await import('../../src/worker/agent/gateway')
  const { proxyAgentCall } = await import('../../src/worker/agent/proxy-client')
  const { AgentCallError } = await import('../../src/contracts/agent-errors')
  const { worker, published, children } = await started()
  const order: string[] = []
  const providerAbort = new AbortController()
  let began: () => void = () => undefined
  const running = new Promise<void>((resolve) => { began = resolve })
  const gateway = await startAgentGateway({
    provider: async () => new Response('{}'),
    proxy: async (_request, signal, onMetadata) => {
      onMetadata({ callId: 'shutdown-fixture', backend: 'proxy', provider: 'codex', modelSize: 'small', modelId: 'fixture-model', reportedModelId: null, requestedThinking: null, effectiveThinking: 'medium', wireThinking: { reasoning_effort: 'medium' }, configRevision: 'fixture', configHash: 'a'.repeat(64), startedAt: new Date().toISOString(), endedAt: null, durationMs: null, status: 'running', threadId: 'proxy-call:shutdown-fixture' })
      began()
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
      order.push('proxy-drained')
      throw new AgentCallError('cancelled', 'Shutdown fixture cancelled', { phase: 'read' })
    },
  }, providerAbort.signal)
  let gatewayClosed = false
  Object.assign(worker, { providerAbort, providerGateway: { ...gateway, close: async () => { await gateway.close(); gatewayClosed = true; order.push('gateway-closed') } }, agentBackends: { drain: async () => { order.push('host-drained') } } })
  const runAbort = new AbortController()
  const call = proxyAgentCall(gateway)({ backend: 'proxy', provider: 'codex', modelSize: 'small', prompt: 'Synthetic shutdown', tools: [], timeoutSeconds: 30 }, runAbort.signal, () => {}).catch(error => error)
  try {
    await running
    children[0]!.postMessage.mockImplementation((message: unknown) => {
      if (message !== 'stop') return
      order.push('worker-stop')
      runAbort.abort()
      void (async () => { await call; order.push('worker-drained'); children[0]!.emit('exit', 0) })()
    })
    await worker.stop()
    expect(await call).toMatchObject({ code: 'cancelled' })
    expect(order.indexOf('worker-stop')).toBeLessThan(order.indexOf('proxy-drained'))
    expect(order.indexOf('proxy-drained')).toBeLessThan(order.indexOf('worker-drained'))
    expect(order.indexOf('worker-drained')).toBeLessThan(order.indexOf('host-drained'))
    expect(order.indexOf('host-drained')).toBeLessThan(order.indexOf('gateway-closed'))
    expect(published.at(-1)?.state).toBe('stopped')
  }
  finally { runAbort.abort(); if (!gatewayClosed) await gateway.close() }
})

it('drains and closes the old proxy gateway before a storage recovery starts a fresh host lifetime', async () => {
  const { worker, children } = await started()
  const order: string[] = []
  const providerAbort = new AbortController()
  providerAbort.abort(new Error('Previous lifetime ended'))
  let release: () => void = () => undefined
  const closing = new Promise<void>((resolve) => { release = resolve })
  const close = vi.fn(async () => { order.push('gateway-closing'); await closing; order.push('gateway-closed') })
  const drain = vi.fn(async () => { order.push('proxy-drained') })
  Object.assign(worker, { providerAbort, agentBackends: { drain }, providerGateway: { close }, state: { state: 'recovery', pid: children[0]!.pid, error: null } })
  const recovered = worker.retryStorage()
  await expect.poll(() => close.mock.calls.length).toBe(1)
  expect(fork).toHaveBeenCalledTimes(1)
  expect(drain).toHaveBeenCalled()
  release(); await recovered
  expect(fork).toHaveBeenCalledTimes(2)
  expect(order.indexOf('proxy-drained')).toBeLessThan(order.indexOf('gateway-closing'))
  const lifetime = (worker as unknown as { providerAbort: AbortController }).providerAbort
  expect(lifetime).not.toBe(providerAbort)
  expect(lifetime.signal.aborted).toBe(false)
  children[1]!.emit('exit', 0)
})
