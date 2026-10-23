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
const support = vi.hoisted(() => ({ supported: true }))
// The real gateway by default; a test may hand out one deferred gateway to model a late acquisition.
const gatewayControl = vi.hoisted(() => ({ next: null as Promise<unknown> | null }))
vi.mock('../../src/worker/agent/gateway', async (original) => {
  const actual = await original<typeof import('../../src/worker/agent/gateway')>()
  return { ...actual, startAgentGateway: (...args: Parameters<typeof actual.startAgentGateway>) => { const deferred = gatewayControl.next; gatewayControl.next = null; return deferred ?? actual.startAgentGateway(...args) } }
})
vi.mock('../../src/main/support', async original => ({ ...await original<typeof import('../../src/main/support')>(), assertExecutionSupported: () => { if (!support.supported) throw new Error('Pod execution is blocked on darwin 99.0.0 (arm64): synthetic') } }))

class Child extends EventEmitter {
  pid = 4242
  stderr = new EventEmitter()
  postMessage = vi.fn()
  kill = vi.fn(() => { this.emit('exit', 15) })
}
const roots: string[] = []
afterEach(() => { support.supported = true; gatewayControl.next = null; vi.restoreAllMocks(); vi.useRealTimers(); fork.mockReset(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
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

it('starts storage and the account service on an unverified kernel while every execution entry stays refused', async () => {
  support.supported = false
  const { worker, published } = await started()
  expect(fork).toHaveBeenCalledTimes(1)
  expect(published.at(-1)).toMatchObject({ state: 'starting', error: null })
  await expect(worker.executionReady()).rejects.toThrow('Pod execution is blocked on darwin 99.0.0')
  await expect(worker.cli({ channel: 'runs', command: { type: 'start', podId: '00000000-0000-4000-8000-000000000001' } } as never)).rejects.toThrow('Pod execution is blocked')
  const programs = { openShell: vi.fn(), launch: vi.fn(), prepare: vi.fn(), launchStatus: vi.fn(async () => null) }
  Object.assign(worker, { programs })
  const podId = '00000000-0000-4000-8000-000000000001'
  for (const command of [{ type: 'openShell', podId }, { type: 'launch', podId, applicationId: podId }, { type: 'prepare', podId, line: 'id' }]) await expect(worker.program(command as never)).rejects.toThrow('Pod execution is blocked')
  expect(programs.openShell).not.toHaveBeenCalled(); expect(programs.launch).not.toHaveBeenCalled(); expect(programs.prepare).not.toHaveBeenCalled()
  await worker.program({ type: 'launchStatus', podId })
  expect(programs.launchStatus).toHaveBeenCalledOnce()
})

it('retries a failed account setup a bounded number of times and then reports the cause', async () => {
  vi.useFakeTimers()
  const { worker, published, children } = await started()
  const initialize = vi.fn(async () => { throw new Error('Gateway port unavailable') })
  const close = vi.fn(async () => {})
  Object.assign(worker, { initializeConnections: initialize, releaseServices: close })
  children[0]!.emit('message', 'ready')
  await vi.advanceTimersByTimeAsync(10000)
  expect(initialize).toHaveBeenCalledTimes(3)
  expect(close).toHaveBeenCalledTimes(3)
  expect(published.at(-1)).toMatchObject({ state: 'error', pid: 4242, error: 'Account service setup failed: Gateway port unavailable' })
  await expect(worker.remoteOwner()).rejects.toThrow('Connection service unavailable (error): Account service setup failed: Gateway port unavailable')
  initialize.mockReset()
})

it('recovers from a transient account setup failure without publishing the failure', async () => {
  vi.useFakeTimers()
  const { worker, published, children } = await started()
  const initialize = vi.fn().mockRejectedValueOnce(new Error('Worker response timed out; reload state before retrying')).mockResolvedValue(undefined)
  Object.assign(worker, { initializeConnections: initialize })
  children[0]!.emit('message', 'ready')
  await vi.advanceTimersByTimeAsync(1500)
  expect(initialize).toHaveBeenCalledTimes(2)
  expect(published.map(status => status.state)).toEqual(['starting', 'ready'])
})

it('restarts an exited worker once for concurrent requests and leaves a starting worker alone', async () => {
  const { worker, published, children } = await started()
  await worker.restart()
  expect(fork).toHaveBeenCalledTimes(1)
  children[0]!.emit('exit', 1)
  expect(published.at(-1)).toMatchObject({ state: 'error', error: 'Worker exited (1). Quit and reopen Pods to recover.' })
  await expect(worker.mcpOwnerSession(Date.now() + 1000, AbortSignal.timeout(1000), () => {})).rejects.toThrow('Connection service unavailable (error): Worker exited (1)')
  await Promise.all([worker.restart(), worker.restart(), worker.restart()])
  expect(fork).toHaveBeenCalledTimes(2)
  expect(published.at(-1)).toMatchObject({ state: 'starting', pid: 4242 })
  await worker.restart()
  expect(fork).toHaveBeenCalledTimes(2)
})

it('supersedes a hanging setup on restart so its late result neither dispatches nor assigns account services', async () => {
  const { AgentBackendManager } = await import('../../src/main/agent-backends/manager')
  let resume: () => void = () => undefined
  const reload = vi.spyOn(AgentBackendManager.prototype, 'reload').mockImplementationOnce(() => new Promise((resolve) => { resume = () => resolve({} as never) }))
  const drain = vi.spyOn(AgentBackendManager.prototype, 'drain').mockResolvedValue(undefined)
  const { worker, published, children } = await started()
  const dispatch = vi.fn(async () => true)
  Object.assign(worker, { dispatch })
  children[0]!.emit('message', 'ready')
  await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
  children[0]!.emit('exit', 9)
  await worker.restart()
  expect(fork).toHaveBeenCalledTimes(2)
  expect(drain).toHaveBeenCalled()
  resume()
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(dispatch).not.toHaveBeenCalled()
  expect((worker as unknown as { agentBackends: unknown, providerGateway: unknown }).agentBackends).toBeNull()
  expect((worker as unknown as { providerGateway: unknown }).providerGateway).toBeNull()
  expect(published.some(status => status.state === 'ready')).toBe(false)
})

it('ends a hanging setup with its phase, releases what it created and lets the owner restart', async () => {
  vi.useFakeTimers()
  const { AgentBackendManager } = await import('../../src/main/agent-backends/manager')
  const reload = vi.spyOn(AgentBackendManager.prototype, 'reload').mockImplementation(() => new Promise<never>(() => {}))
  const drain = vi.spyOn(AgentBackendManager.prototype, 'drain').mockResolvedValue(undefined)
  const { worker, published, children } = await started()
  children[0]!.emit('message', 'ready')
  await vi.advanceTimersByTimeAsync(89_000)
  expect(published.at(-1)?.state).toBe('starting')
  await vi.advanceTimersByTimeAsync(2_000)
  expect(reload).toHaveBeenCalledTimes(1)
  expect(drain).toHaveBeenCalledTimes(1)
  expect(published.at(-1)).toMatchObject({ state: 'error', error: 'Account service setup failed: Account service setup did not finish within 90 seconds (phase: agent backends)' })
  await expect(worker.onboarding({ type: 'list' })).rejects.toThrow('Connection service unavailable (error): Account service setup failed: Account service setup did not finish within 90 seconds (phase: agent backends)')
  const restarted = worker.restart()
  await vi.advanceTimersByTimeAsync(0); await restarted
  expect(fork).toHaveBeenCalledTimes(2)
})

it('reports a failed cleanup instead of retrying on top of a half-released setup, and refuses a restart beside it', async () => {
  vi.useFakeTimers()
  const { worker, published, children } = await started()
  Object.assign(worker, { initializeConnections: vi.fn(async (_epoch: number, owned: Record<string, unknown>) => { owned.providerGateway = { close: async () => { throw new Error('Gateway socket still open') } }; throw new Error('Synthetic setup failure') }) })
  children[0]!.emit('message', 'ready')
  await vi.advanceTimersByTimeAsync(5_000)
  expect(published.at(-1)).toMatchObject({ state: 'error', error: 'Account service setup failed: Synthetic setup failure; release failed: Account service cleanup failed: Gateway socket still open; quit and reopen Pods' })
  await expect(worker.restart()).rejects.toThrow('Account service cleanup failed: Gateway socket still open; quit and reopen Pods')
  expect(fork).toHaveBeenCalledTimes(1)
})

it('latches a release that does not finish in time so a later restart cannot start services beside it', async () => {
  vi.useFakeTimers()
  const { worker, published, children } = await started()
  Object.assign(worker, { initializeConnections: vi.fn(async (_epoch: number, owned: Record<string, unknown>) => { owned.providerGateway = { close: () => new Promise(() => {}) }; throw new Error('Synthetic setup failure') }) })
  children[0]!.emit('message', 'ready')
  await vi.advanceTimersByTimeAsync(10_500)
  expect(published.at(-1)).toMatchObject({ state: 'error', error: 'Account service setup failed: Synthetic setup failure; release failed: Account service cleanup did not finish within 10 seconds; quit and reopen Pods' })
  await expect(worker.restart()).rejects.toThrow('quit and reopen Pods')
  expect(fork).toHaveBeenCalledTimes(1)
})

it('keeps a replacement worker\'s services when the dead worker\'s pending setup resumes and fails', async () => {
  const { AgentBackendManager } = await import('../../src/main/agent-backends/manager')
  const resumes: (() => void)[] = []
  const reload = vi.spyOn(AgentBackendManager.prototype, 'reload').mockImplementation(() => new Promise((resolve) => { resumes.push(() => resolve({} as never)) }))
  const drain = vi.spyOn(AgentBackendManager.prototype, 'drain').mockResolvedValue(undefined)
  const { worker, published, children } = await started()
  Object.assign(worker, { dispatch: vi.fn(async () => true) })
  const backends = () => (worker as unknown as { agentBackends: unknown }).agentBackends
  children[0]!.emit('message', 'ready')
  await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
  const old = backends()
  children[0]!.emit('exit', 9)
  await worker.restart()
  expect(drain.mock.contexts).toContain(old)
  children[1]!.emit('message', 'ready')
  await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(2))
  const replacement = backends()
  expect(replacement).not.toBe(old)
  drain.mockClear()
  resumes[0]!()
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(backends()).toBe(replacement)
  expect(drain.mock.contexts).not.toContain(replacement)
  expect(published.at(-1)?.state).toBe('starting')
})

it('stops credential recovery steps of a superseded setup before they reach a later lifetime', async () => {
  const { worker } = await started()
  let current = true
  const live = () => { if (!current) throw new Error('Superseded account service setup') }
  const connections = { purgePodKeys: vi.fn(async () => { current = false }) }
  const dispatch = vi.fn(async (command: { data?: { type: string } }) => command.data?.type === 'jobs' ? [{ podId: 'a', keyIds: [] }, { podId: 'b', keyIds: [] }] : true)
  Object.assign(worker, { dispatch })
  const recovery = worker as unknown as { finishDeletions: (connections: unknown, live: () => void) => Promise<void>, migrateHttpCredentials: (podId: undefined, credentials: unknown, live: () => void) => Promise<void> }
  await expect(recovery.finishDeletions(connections, live)).rejects.toThrow('Superseded')
  expect(connections.purgePodKeys).toHaveBeenCalledTimes(1)
  expect(dispatch.mock.calls.filter(([command]) => command.data?.type === 'finishDeletion')).toHaveLength(0)
  const credentials = { migrateHttp: vi.fn(async () => {}) }
  dispatch.mockResolvedValueOnce([{ id: 'x', podId: 'a', alias: 'one' }] as never)
  await expect(recovery.migrateHttpCredentials(undefined, credentials, live)).rejects.toThrow('Superseded')
  expect(credentials.migrateHttp).not.toHaveBeenCalled()
})

it('never forks a second worker while the previous one has not exited', async () => {
  vi.useFakeTimers()
  const { worker, children } = await started()
  Object.assign(worker, { initializeConnections: vi.fn(async () => { throw new Error('Synthetic setup failure') }) })
  children[0]!.emit('message', 'ready')
  await vi.advanceTimersByTimeAsync(5_000)
  children[0]!.kill = vi.fn()
  const restarted = worker.restart().catch((error: unknown) => error)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(await restarted).toMatchObject({ message: 'The previous worker did not exit within 10 seconds; quit and reopen Pods' })
  expect(children[0]!.kill).toHaveBeenCalledTimes(1)
  expect(fork).toHaveBeenCalledTimes(1)
})

it('invalidates a pending setup as soon as its worker exits, before any restart', async () => {
  const { AgentBackendManager } = await import('../../src/main/agent-backends/manager')
  let resume: () => void = () => undefined
  const reload = vi.spyOn(AgentBackendManager.prototype, 'reload').mockImplementationOnce(() => new Promise((resolve) => { resume = () => resolve({} as never) }))
  vi.spyOn(AgentBackendManager.prototype, 'drain').mockResolvedValue(undefined)
  const { worker, children } = await started()
  const dispatch = vi.fn(async () => true)
  Object.assign(worker, { dispatch })
  children[0]!.emit('message', 'ready')
  await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
  children[0]!.emit('exit', 9)
  resume()
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(dispatch).not.toHaveBeenCalled()
  expect((worker as unknown as { agentBackends: unknown }).agentBackends).toBeNull()
})

it('closes a gateway that arrives after its timed-out setup was released and a replacement started, without touching the replacement', async () => {
  vi.useFakeTimers()
  const { AgentBackendManager } = await import('../../src/main/agent-backends/manager')
  let replacementReload: () => void = () => undefined
  vi.spyOn(AgentBackendManager.prototype, 'reload').mockResolvedValueOnce({} as never).mockImplementationOnce(() => new Promise((resolve) => { replacementReload = () => resolve({} as never) }))
  const drain = vi.spyOn(AgentBackendManager.prototype, 'drain').mockResolvedValue(undefined)
  let deliver: (gateway: unknown) => void = () => undefined
  gatewayControl.next = new Promise((resolve) => { deliver = resolve })
  const { worker, published, children } = await started()
  Object.assign(worker, { dispatch: vi.fn(async () => true) })
  children[0]!.emit('message', 'ready')
  await vi.advanceTimersByTimeAsync(91_000)
  expect(published.at(-1)).toMatchObject({ state: 'error', error: expect.stringContaining('phase: model gateway') })
  const restarted = worker.restart()
  await vi.advanceTimersByTimeAsync(0); await restarted
  expect(fork).toHaveBeenCalledTimes(2)
  children[1]!.emit('message', 'ready')
  await vi.advanceTimersByTimeAsync(0)
  const replacement = (worker as unknown as { agentBackends: unknown }).agentBackends
  expect(replacement).not.toBeNull()
  drain.mockClear()
  const late = { port: 40000, capability: 'a'.repeat(64), close: vi.fn(async () => {}) }
  deliver(late)
  await vi.advanceTimersByTimeAsync(0)
  expect(late.close).toHaveBeenCalledTimes(1)
  expect((worker as unknown as { providerGateway: unknown }).providerGateway).toBeNull()
  expect((worker as unknown as { agentBackends: unknown }).agentBackends).toBe(replacement)
  expect(drain.mock.contexts).not.toContain(replacement)
  replacementReload()
})

it('waits for a release still in progress before a restart starts a replacement worker', async () => {
  const { worker, children } = await started()
  let finish: () => void = () => undefined
  const close = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
  Object.assign(worker, { initializeConnections: vi.fn(async (_epoch: number, owned: Record<string, unknown>) => { owned.providerGateway = { close }; throw new Error('Synthetic setup failure') }) })
  children[0]!.emit('message', 'ready')
  await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1))
  children[0]!.emit('exit', 9)
  const restarted = worker.restart()
  await new Promise(resolve => setTimeout(resolve, 50))
  expect(fork).toHaveBeenCalledTimes(1)
  finish()
  await restarted
  expect(fork).toHaveBeenCalledTimes(2)
})
