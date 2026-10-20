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
import { executeAgent } from '../../src/worker/agent/executor'
import type { AgentRuntime } from '../../src/worker/agent/executor'
import type { RunServices } from '../../src/worker/runs/dispatcher'
import { AgentCallError } from '../../src/contracts/agent-errors'
import type { AgentCallMetadata } from '../../src/contracts/agent-metadata'
import { recoverStoppedRuns } from '../../src/worker/recovery/automatic'
import { confirmDomainsStopped } from '../../src/worker/recovery/domains'

vi.mock('../../src/worker/runs/runner', () => ({ executeScript: vi.fn() }))
vi.mock('../../src/worker/agent/executor', () => ({ executeAgent: vi.fn() }))
const stores: PodDatabase[] = []
afterEach(() => { vi.restoreAllMocks(); vi.mocked(executeScript).mockReset(); vi.mocked(executeAgent).mockReset(); for (const store of stores.splice(0)) { store.close(); rmSync(store.root, { recursive: true, force: true }) } })

function fixture(services: RunServices = {}) {
  const store = new PodDatabase(mkdtempSync(join(tmpdir(), 'pods-agent-run-'))); stores.push(store)
  const resources = new ResourceRegistry(store, () => {})
  const pod = store.createPod({ name: 'Agent lifecycle' })
  installExample(store, resources, pod.id, 'deterministic', 'a'.repeat(64))
  vi.spyOn(resources, 'capture').mockResolvedValue({ id: randomUUID(), files: [] } as never)
  const dispatcher = new RunDispatcher(store, resources, { helper: '/unused', environment: {} } as AgentRuntime, services)
  return { store, pod, dispatcher }
}

const proxyRequest = { backend: 'proxy', provider: 'claude', modelSize: 'medium', thinking: 'high', prompt: 'Synthetic text' } as const
function metadata(status: AgentCallMetadata['status']): AgentCallMetadata {
  return { callId: 'fixture-call', backend: 'proxy', provider: 'claude', modelSize: 'medium', modelId: 'claude-sonnet-5-5', reportedModelId: null, requestedThinking: 'high', effectiveThinking: 'high', wireThinking: { type: 'adaptive', effort: 'high' }, configRevision: '1', configHash: 'a'.repeat(64), startedAt: new Date().toISOString(), endedAt: status === 'running' ? null : new Date().toISOString(), durationMs: status === 'running' ? null : 1, status, threadId: 'proxy-call:fixture-call' }
}

function acceptedInput(store: PodDatabase, podId: string): string {
  const id = randomUUID()
  store.db.prepare('INSERT INTO accepted_events(id,pod_id,source,dedupe_key,payload,accepted_at,state) VALUES(?,?,\'webhook\',?,\'{}\',?,\'pending\')').run(id, podId, id, Date.now())
  return id
}

function expectIsolated(store: PodDatabase, dispatcher: RunDispatcher, id: string): void {
  expect(dispatcher.runs.get(id).automaticRecovery).toMatchObject({ disposition: 'isolated', cause: 'non-retryable', nextAt: null })
  expect(store.db.prepare('SELECT retry_at FROM run_inputs WHERE run_id=?').get(id)?.retry_at).toBeNull()
  expect(store.db.prepare('SELECT 1 FROM accepted_events WHERE run_id=? AND state=\'pending\'').get(id)).toBeUndefined()
}

it('bounds a standalone run to 50 agent calls, as for network members', async () => {
  const store = new PodDatabase(mkdtempSync(join(tmpdir(), 'pods-agent-run-'))); stores.push(store)
  const resources = new ResourceRegistry(store, () => {})
  const pod = store.createPod({ name: 'Agent run' })
  installExample(store, resources, pod.id, 'deterministic', 'a'.repeat(64))
  vi.spyOn(resources, 'capture').mockResolvedValue({ id: randomUUID(), files: [] } as never)
  vi.mocked(executeAgent).mockResolvedValue({ threadId: 'synthetic', response: 'done' })
  let refusal = ''
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, input, signal, hooks) => {
    for (let call = 0; call < 50; call++) await hooks.request('agent.run', { prompt: 'Synthetic task', tools: [] }, signal)
    await hooks.request('agent.run', { prompt: 'Synthetic task', tools: [] }, signal).catch((error: Error) => { refusal = error.message })
    return { status: 'completed', summary: 'Agent calls bounded', completedInputIds: input.eventIds, gapIds: [] }
  })
  const model = async () => 'fixture-account-default'
  const dispatcher = new RunDispatcher(store, resources, { helper: '/unused', environment: {} } as AgentRuntime, { provider: async () => new Response('{}'), model })
  dispatcher.start(pod.id)
  await expect.poll(() => dispatcher.view(pod.id).runs[0]?.state).toBe('completed')
  expect(executeAgent).toHaveBeenCalledTimes(50)
  expect(vi.mocked(executeAgent).mock.calls[0]![4].model).toBe(model)
  expect(refusal).toBe('A run can start at most 50 agent calls')
})

it('parses invalid proxy requests before checking native availability and allows proxy without native', async () => {
  const proxy = vi.fn(async () => ({ threadId: 'proxy-call:one', response: 'Proxy text' }))
  const { dispatcher, pod } = fixture({ proxy })
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, input, signal, hooks) => {
    await expect(hooks.request('agent.run', { ...proxyRequest, tools: ['ape_shell'] }, signal)).rejects.toMatchObject({ code: 'unsupported_combination' })
    await expect(hooks.request('agent.run', proxyRequest, signal)).resolves.toEqual({ threadId: 'proxy-call:one', response: 'Proxy text' })
    await expect(hooks.request('agent.run', { prompt: 'Legacy task' }, signal)).rejects.toThrow('Codex is not connected')
    return { status: 'completed', summary: 'Independent proxy works', completedInputIds: input.eventIds, gapIds: [] }
  })
  dispatcher.start(pod.id)
  await expect.poll(() => dispatcher.view(pod.id).runs[0]?.state).toBe('completed')
  expect(proxy).toHaveBeenCalledOnce()
  expect(executeAgent).not.toHaveBeenCalled()
})

it('shares the call budget across both backends and passes explicit text into the next call', async () => {
  const proxy = vi.fn(async () => ({ threadId: 'proxy-call:one', response: 'Exact handoff' }))
  vi.mocked(executeAgent).mockResolvedValue({ threadId: 'native-thread', response: 'Native reply' })
  const { dispatcher, pod } = fixture({ proxy, provider: async () => new Response('{}') })
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, input, signal, hooks) => {
    const result = await hooks.request('agent.run', proxyRequest, signal) as { response: string }
    await hooks.request('agent.run', { prompt: result.response, tools: ['ape_shell'] }, signal)
    for (let count = 2; count < 50; count++) await hooks.request('agent.run', count % 2 ? proxyRequest : { prompt: 'Native text' }, signal)
    await expect(hooks.request('agent.run', proxyRequest, signal)).rejects.toThrow('at most 50')
    return { status: 'completed', summary: 'Shared count verified', completedInputIds: input.eventIds, gapIds: [] }
  })
  dispatcher.start(pod.id)
  await expect.poll(() => dispatcher.view(pod.id).runs[0]?.state).toBe('completed')
  expect(executeAgent).toHaveBeenCalledTimes(25)
  expect(proxy).toHaveBeenCalledTimes(25)
  expect(vi.mocked(executeAgent).mock.calls[0]![2]).toBe('Exact handoff')
  expect(vi.mocked(executeAgent).mock.calls[0]![7]).toEqual(['ape_shell'])
})

it.each(['native', 'proxy'] as const)('disconnecting %s cancels only its active call and remains catchable', async (backend) => {
  let nativeSignal: AbortSignal | undefined; let proxySignal: AbortSignal | undefined
  let finishNative!: () => void; let finishProxy!: () => void
  vi.mocked(executeAgent).mockImplementation(async (_runtime, _root, _prompt, _references, _services, signal) => {
    nativeSignal = signal
    return new Promise((resolve, reject) => { finishNative = () => resolve({ threadId: 'native', response: 'native text' }); signal.addEventListener('abort', () => reject(signal.reason), { once: true }) })
  })
  const services: RunServices = {
    provider: async () => new Response('{}'),
    proxy: async (_request, signal) => {
      proxySignal = signal
      return new Promise((resolve, reject) => { finishProxy = () => resolve({ threadId: 'proxy', response: 'proxy text' }); signal.addEventListener('abort', () => reject(signal.reason), { once: true }) })
    },
  }
  const { dispatcher, pod } = fixture(services)
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, input, signal, hooks) => {
    const native = hooks.request('agent.run', { prompt: 'Native text' }, signal)
    const proxy = hooks.request('agent.run', proxyRequest, signal)
    const affected = backend === 'native' ? native : proxy
    const unaffected = backend === 'native' ? proxy : native
    const refused = expect(affected).rejects.toMatchObject({ code: 'cancelled' })
    dispatcher.cancelBackend(backend)
    expect(backend === 'native' ? proxySignal!.aborted : nativeSignal!.aborted).toBe(false)
    if (backend === 'native') finishProxy(); else finishNative()
    await refused; await unaffected
    return { status: 'completed', summary: 'Cancellation caught', completedInputIds: input.eventIds, gapIds: [] }
  })
  dispatcher.start(pod.id)
  await expect.poll(() => dispatcher.view(pod.id).runs[0]?.state).toBe('completed')
})

it.each(['owner', 'shutdown'] as const)('drains a proxy cancelled by %s without queuing automatic replay', async (cause) => {
  let settled = false
  const { store, dispatcher, pod } = fixture({
    proxy: async (_request, signal, event) => {
      // The safe dispatch receipt must already be committed before any host metadata exists.
      const intent = store.db.prepare('SELECT data FROM run_events WHERE type=\'agent-dispatch\'').get()
      expect(JSON.parse(String(intent?.data))).toEqual({ backend: 'proxy' })
      event(metadata('running'))
      await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => { event(metadata('cancelled')); settled = true; reject(new AgentCallError('cancelled', 'Cancelled', { phase: 'read' })) }, { once: true }))
      return { threadId: 'unused', response: 'unused' }
    },
  })
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, _input, signal, hooks) => {
    await hooks.request('agent.run', proxyRequest, signal)
    throw new Error('Unexpected success')
  })
  const inputId = acceptedInput(store, pod.id)
  const id = dispatcher.start(pod.id, { reason: 'event', eventIds: [inputId] })
  await expect.poll(() => dispatcher.view(pod.id).events.filter(event => event.type === 'agent-call').length).toBe(1)
  if (cause === 'owner') dispatcher.cancelPod(pod.id)
  else await dispatcher.stop()
  await expect.poll(() => dispatcher.view(pod.id).runs[0]?.state).toBe('cancelled')
  expect(settled).toBe(true)
  const calls = dispatcher.view(pod.id).events.filter(event => event.type === 'agent-call')
  expect(calls).toHaveLength(2)
  expect(calls.map(event => (event.data as AgentCallMetadata).status)).toEqual(['running', 'cancelled'])
  expectIsolated(store, dispatcher, id)
  expect(store.db.prepare('SELECT state FROM accepted_events WHERE id=?').get(inputId)?.state).toBe('failed')
})

it.each(['dispatch-only', 'running-receipt', 'completed-receipt'] as const)('isolates a crashed run with %s proxy evidence', async (evidence) => {
  const proxy = vi.fn()
  const { store, dispatcher, pod } = fixture({ proxy })
  const inputId = acceptedInput(store, pod.id)
  const { run } = dispatcher.runs.reserve(pod.id, store.getPod(pod.id).activeScript!, 0, { reason: 'event', eventIds: [inputId] })
  if (evidence === 'dispatch-only') dispatcher.runs.append(run.id, 'agent-dispatch', { backend: 'proxy' })
  else dispatcher.runs.append(run.id, 'agent-call', metadata(evidence === 'running-receipt' ? 'running' : 'completed'))
  // A fresh worker fences the old run before automatic recovery, without executing its script.
  const recovered = new RunDispatcher(store, new ResourceRegistry(store, () => {}), { helper: '/unused', environment: {} } as AgentRuntime, { proxy })
  expect(recovered.runs.get(run.id).state).toBe('interrupted')
  await recoverStoppedRuns(store, '/unused')
  expectIsolated(store, recovered, run.id)
  expect(store.db.prepare('SELECT state FROM accepted_events WHERE id=?').get(inputId)?.state).toBe('failed')
  expect(store.db.prepare('SELECT 1 FROM run_leases WHERE run_id=?').get(run.id)).toBeUndefined()
  expect(proxy).not.toHaveBeenCalled()
  expect(executeScript).not.toHaveBeenCalled()
})

it('does not replay a successful proxy inference when a later script operation fails', async () => {
  const proxy = vi.fn<NonNullable<RunServices['proxy']>>(async (_request, _signal, event) => {
    event(metadata('completed'))
    return { threadId: 'proxy-call:fixture-call', response: 'Successful synthetic response' }
  })
  const { store, dispatcher, pod } = fixture({ proxy })
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, _input, signal, hooks) => {
    await hooks.request('agent.run', proxyRequest, signal)
    throw new Error('A later operation failed')
  })
  const inputId = acceptedInput(store, pod.id)
  const id = dispatcher.start(pod.id, { reason: 'event', eventIds: [inputId] })
  await expect.poll(() => dispatcher.runs.get(id).state).toBe('failed')
  expectIsolated(store, dispatcher, id)
  expect(dispatcher.runs.get(id).error).toBe('A later operation failed')
  await recoverStoppedRuns(store, '/unused')
  expect(proxy).toHaveBeenCalledOnce()
  expect(store.db.prepare('SELECT state FROM accepted_events WHERE id=?').get(inputId)?.state).toBe('failed')
})

it('drains unawaited agent work before completing a script', async () => {
  let settled = false
  const { dispatcher, pod } = fixture({
    proxy: async (_request, signal) => {
      await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => { settled = true; reject(signal.reason) }, { once: true }))
      return { threadId: 'unused', response: 'unused' }
    },
  })
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, input, signal, hooks) => {
    void hooks.request('agent.run', proxyRequest, signal).catch(() => undefined)
    return { status: 'completed', summary: 'Synthetic script returned early', completedInputIds: input.eventIds, gapIds: [] }
  })
  dispatcher.start(pod.id)
  await expect.poll(() => dispatcher.view(pod.id).runs[0]?.state).toBe('completed')
  expect(settled).toBe(true)
})

it.each(['caught', 'unawaited'] as const)('fences unconfirmed proxy cleanup even when the request is %s', async (mode) => {
  const { store, dispatcher, pod } = fixture({
    proxy: async (_request, signal) => {
      if (mode === 'unawaited') await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
      throw new AgentCallError('proxy_unreachable', 'Proxy cleanup could not be confirmed', { phase: 'read', cause: 'proxy_cleanup_unconfirmed' })
    },
  })
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, input, signal, hooks) => {
    const request = hooks.request('agent.run', proxyRequest, signal).catch(() => undefined)
    if (mode === 'caught') await request
    return { status: 'completed', summary: 'Script attempted to complete', completedInputIds: input.eventIds, gapIds: [] }
  })
  const runId = dispatcher.start(pod.id)
  await expect.poll(() => dispatcher.view(pod.id).runs[0]?.state).toBe('interrupted')
  expect(store.db.prepare('SELECT boot_id FROM run_leases WHERE run_id=?').get(runId)?.boot_id).toMatch(/^fenced:/)
  expect(dispatcher.view(pod.id).events.some(event => event.type === 'finished')).toBe(false)
  expect(dispatcher.view(pod.id).events.filter(event => event.type === 'agent-cleanup')).toHaveLength(1)
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  await recoverStoppedRuns(store, '/unused')
  expect(warning).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('Proxy request cleanup is unconfirmed'))
  expect(store.db.prepare('SELECT 1 FROM run_leases WHERE run_id=?').get(runId)).toBeDefined()
  const kill = vi.spyOn(process, 'kill').mockImplementation((pid) => { expect(pid).toBe(process.ppid); throw Object.assign(new Error('Stopped'), { code: 'ESRCH' }) })
  await expect(confirmDomainsStopped(store, runId, '/unused')).resolves.toBeUndefined()
  expect(kill).toHaveBeenCalledOnce()
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31000)
  await recoverStoppedRuns(store, '/unused')
  expect(store.db.prepare('SELECT 1 FROM run_leases WHERE run_id=?').get(runId)).toBeUndefined()
  expect(dispatcher.runs.get(runId).automaticRecovery).toMatchObject({ disposition: 'isolated', cause: 'non-retryable', nextAt: null })
})

it.each(['uncaught', 'caught-failed', 'caught-completed'] as const)('never automatically repeats a failed proxy inference when %s', async (mode) => {
  const proxy = vi.fn(async () => { throw new AgentCallError('provider_error', 'Proxy request failed (HTTP 400, invalid_request_error)', { phase: 'request', httpStatus: 400, providerCode: 'invalid_request_error' }) })
  const { store, dispatcher, pod } = fixture({ proxy })
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, input, signal, hooks) => {
    const request = hooks.request('agent.run', proxyRequest, signal)
    if (mode === 'uncaught') await request
    else await request.catch(() => undefined)
    return { status: mode === 'caught-completed' ? 'completed' : 'failed', summary: 'Script handled the result', completedInputIds: input.eventIds, gapIds: [] }
  })
  const id = dispatcher.start(pod.id)
  await expect.poll(() => dispatcher.runs.get(id).state).toBe(mode === 'caught-completed' ? 'completed' : 'failed')
  expect(proxy).toHaveBeenCalledOnce()
  if (mode === 'caught-completed') expect(dispatcher.runs.get(id).automaticRecovery).toBeUndefined()
  else expect(dispatcher.runs.get(id).automaticRecovery).toMatchObject({ disposition: 'isolated', cause: 'non-retryable', nextAt: null })
  await recoverStoppedRuns(store, '/unused')
  expect(proxy).toHaveBeenCalledOnce()
  expect(store.db.prepare('SELECT retry_at FROM run_inputs WHERE run_id=?').get(id)?.retry_at).toBeNull()
})

it('retains the existing native failure recovery policy', async () => {
  vi.mocked(executeAgent).mockRejectedValue(new Error('Native fixture failed'))
  const { dispatcher, pod } = fixture({ provider: async () => new Response('{}') })
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, input, signal, hooks) => {
    await hooks.request('agent.run', { prompt: 'Native text' }, signal)
    return { status: 'completed', summary: 'Unreachable', completedInputIds: input.eventIds, gapIds: [] }
  })
  const id = dispatcher.start(pod.id)
  await expect.poll(() => dispatcher.runs.get(id).state).toBe('failed')
  expect(dispatcher.runs.get(id).automaticRecovery).toMatchObject({ disposition: 'retry', cause: 'failure' })
})

it('retains automatic native retry after normal application shutdown', async () => {
  vi.mocked(executeAgent).mockImplementation(async (_runtime, _root, _prompt, _references, _services, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })))
  const { store, dispatcher, pod } = fixture({ provider: async () => new Response('{}') })
  vi.mocked(executeScript).mockImplementation(async (_runtime, _directory, _artifact, input, signal, hooks) => {
    await hooks.request('agent.run', { prompt: 'Native text' }, signal)
    return { status: 'completed', summary: 'Unreachable', completedInputIds: input.eventIds, gapIds: [] }
  })
  const inputId = acceptedInput(store, pod.id)
  const id = dispatcher.start(pod.id, { reason: 'event', eventIds: [inputId] })
  await expect.poll(() => vi.mocked(executeAgent).mock.calls.length).toBe(1)
  await dispatcher.stop()
  expect(dispatcher.runs.get(id)).toMatchObject({ state: 'cancelled', automaticRecovery: { disposition: 'retry', cause: 'shutdown', nextAt: expect.any(Number) } })
  expect(store.db.prepare('SELECT state FROM accepted_events WHERE id=?').get(inputId)?.state).toBe('pending')
  expect(store.db.prepare('SELECT 1 FROM run_events WHERE run_id=? AND type=\'agent-dispatch\'').get(id)).toBeUndefined()
})
