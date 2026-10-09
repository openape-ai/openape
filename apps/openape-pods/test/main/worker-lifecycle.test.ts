// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { handleMailArchive } from '../../src/main/mail/archive/handler'
import type { ServiceRequest } from '../../src/contracts/services'

vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() }, safeStorage: {}, app: { getPath: () => '/nonexistent' }, shell: { openExternal: vi.fn(async () => {}) } }))
vi.mock('../../src/main/mail/archive/handler', () => ({ handleMailArchive: vi.fn() }))

it.each([false, true])('keeps archive authority alive until its asynchronous operation settles (failure: %s)', async (failure) => {
  const { FixtureWorker } = await import('../../src/main/worker')
  const worker = new FixtureWorker(() => {})
  const id = '00000000-0000-4000-8000-000000000001'
  const dispatch = vi.fn(async (command: Record<string, unknown>) => 'runContext' in command ? { name: 'Mail review', reason: 'manual', runtime: false } : { resources: [], epoch: 0 })
  Object.assign(worker, { root: '/unused', credentials: {}, connections: {}, dispatch })
  let signal: AbortSignal | undefined
  vi.mocked(handleMailArchive).mockImplementationOnce(async (input) => {
    signal = input.signal
    await new Promise<void>(resolve => setImmediate(resolve))
    input.signal.throwIfAborted()
    if (failure) throw new Error('Provider unavailable')
    return { state: 'pending', count: 1 }
  })
  const service = worker as unknown as { executeService: (request: ServiceRequest) => Promise<unknown> }
  const operation = service.executeService({ id, kind: 'mailArchive', scope: { podId: id, runId: id, epoch: 0, assignmentRevision: 1, capabilities: [] }, body: { operation: 'process' } })
  if (failure) await expect(operation).rejects.toThrow('Provider unavailable')
  else await expect(operation).resolves.toEqual({ state: 'pending', count: 1 })
  expect(signal?.aborted).toBe(true)
  expect(dispatch).toHaveBeenCalledTimes(failure ? 2 : 3)
})

// Last link of the suspend chain (powerMonitor → FixtureWorker → worker
// process): test/main/app.test.ts covers the first, worker-entry.test.ts the last.
it('passes suspend and resume to a ready worker process only', async () => {
  const { FixtureWorker } = await import('../../src/main/worker')
  const worker = new FixtureWorker(() => {})
  const child = { postMessage: vi.fn() }
  Object.assign(worker, { child, state: { state: 'starting', pid: 1, error: null } })
  worker.lifecycle('suspend')
  expect(child.postMessage).not.toHaveBeenCalled()
  Object.assign(worker, { state: { state: 'ready', pid: 1, error: null } })
  worker.lifecycle('suspend'); worker.lifecycle('resume')
  expect(child.postMessage.mock.calls).toEqual([['suspend'], ['resume']])
})

it('adopts missing identities through the verified owner without reprovisioning existing Pods', async () => {
  const { FixtureWorker } = await import('../../src/main/worker')
  const worker = new FixtureWorker(() => {})
  const owner = { issuer: 'https://owner.example', subject: 'owner' }
  const existingId = '00000000-0000-4000-8000-000000000001'
  const missingId = '00000000-0000-4000-8000-000000000002'
  const existing = { podId: existingId, identity: { podId: existingId } }
  const created = { podId: missingId }
  const connections = { existingRemotePods: vi.fn(async () => [existing]), podConnection: vi.fn(async () => ({ identity: created })) }
  const dispatch = vi.fn(async () => ({ pods: [existingId, missingId].map(id => ({ id, name: id, revision: 1, lifecycle: 'paused', activeScript: null })), organization: { revision: 1, groups: [] } }))
  const remote = vi.spyOn(worker, 'remote').mockResolvedValue({})
  Object.assign(worker, { connections, dispatch, central: {} })
  await worker.indexRemotePods(owner)
  expect(connections.podConnection).toHaveBeenCalledExactlyOnceWith(missingId, owner)
  expect(remote.mock.calls).toEqual([
    [{ type: 'claim', podId: existingId, owner, identity: existing.identity }],
    [{ type: 'claim', podId: missingId, owner, identity: created }],
  ])
  remote.mockClear()
  connections.podConnection.mockRejectedValueOnce(new Error('Pod belongs to another owner'))
  await expect(worker.indexRemotePods(owner)).rejects.toThrow('another owner')
  expect(remote).not.toHaveBeenCalled()
})

it('forwards central MCP reads and stable commands without a second local operation', async () => {
  const { FixtureWorker } = await import('../../src/main/worker')
  const worker = new FixtureWorker(() => {})
  const id = '00000000-0000-4000-8000-000000000001'
  const result = { state: 'applied', id }
  const query = vi.fn(async () => result)
  const local = vi.fn()
  Object.assign(worker, { central: { query, local, available: false } })
  const commands = [
    { type: 'inventory' }, { type: 'read', runtimeId: id, podId: id },
    { type: 'submit', runtimeId: id, revision: 4, id, command: { channel: 'workspace', body: { type: 'create', name: 'Test Pod' } } },
    { type: 'operation', id },
  ]
  for (const command of commands) {
    expect(await worker.codex({ id, action: { action: 'workspace', query: command } })).toBe(result)
    expect(query).toHaveBeenLastCalledWith(command.type === 'read' ? { ...command, view: 'summary' } : command)
  }
  expect(local).not.toHaveBeenCalled()
  query.mockRejectedValueOnce(new Error('pod_offline'))
  await expect(worker.codex({ id, action: { action: 'workspace', query: commands[1] } })).rejects.toThrow('pod_offline')
})

it('rejects MCP attempts to override leases, submit local closures or bypass central authority', async () => {
  const { FixtureWorker } = await import('../../src/main/worker')
  const worker = new FixtureWorker(() => {})
  const id = '00000000-0000-4000-8000-000000000001'
  const query = vi.fn()
  Object.assign(worker, { central: { query } })
  for (const value of [
    { type: 'inventory', owner: 'other' }, { type: 'read', runtimeId: id, podId: id, lease: id },
    { type: 'submit', runtimeId: id, revision: 1, id, command: { channel: 'local', body: { type: 'ownerAction' } } },
    { type: 'submit', runtimeId: id, revision: 1, id, command: { channel: 'resources', body: { type: 'saveCredential', podId: id, alias: 'secret', value: 'forbidden', epoch: 1 } } },
    { type: 'publish' }, { type: 'read', runtimeId: id }, { type: 'operation', id: 'invalid' },
  ]) await expect(worker.codex({ id, action: { action: 'workspace', query: value } })).rejects.toThrow()
  expect(query).not.toHaveBeenCalled()
  worker.central = null
  await expect(worker.codex({ id, action: { action: 'workspace', query: { type: 'inventory' } } })).rejects.toThrow('Connect the central workspace')
})

it('imports an initial Jev connection from a private file and refuses replacement or stale resources', async () => {
  const { FixtureWorker } = await import('../../src/main/worker')
  const root = mkdtempSync(join(tmpdir(), 'pods-jev-import-'))
  try {
    const path = join(root, 'key'); writeFileSync(path, 'synthetic-jev-key', { mode: 0o600 })
    const worker = new FixtureWorker(() => {})
    const id = '00000000-0000-4000-8000-000000000001'
    const dispatch = vi.fn(async () => ({ completed: false }))
    let connected = false
    const resources = vi.spyOn(worker, 'resources').mockImplementation(async () => ({ epoch: 1, resources: [], variables: [], jev: connected ? { id, state: 'ready', verifiedAt: 1 } : null }))
    const onboarding = vi.spyOn(worker, 'onboarding').mockImplementation(async (command) => { expect(command).toEqual({ type: 'saveTypesafe', key: 'synthetic-jev-key' }); connected = true; return {} as never })
    Object.assign(worker, { dispatch })
    const action = { action: 'resources', revision: 1, path, command: { type: 'importJev', podId: id, epoch: 1 } }
    expect(await worker.codex({ id, action })).toEqual({ jev: { id, state: 'ready', verifiedAt: 1 } })
    expect(JSON.stringify(dispatch.mock.calls)).not.toContain('synthetic-jev-key')
    await expect(worker.codex({ id, action })).rejects.toThrow('Secret import failed')
    connected = false
    await expect(worker.codex({ id, action: { ...action, command: { ...action.command, epoch: 0 } } })).rejects.toThrow('Secret import failed')
    expect(onboarding).toHaveBeenCalledTimes(1); expect(resources).toHaveBeenCalledTimes(4)
  }
  finally { rmSync(root, { recursive: true, force: true }) }
})

it('keeps bounded local reads outside central mutation serialization and attests only held owner operations', async () => {
  const { FixtureWorker } = await import('../../src/main/worker')
  const worker = new FixtureWorker(() => {})
  const id = '00000000-0000-4000-8000-000000000001'
  const dispatch = vi.fn(async () => ({}))
  const central = { executing: false, networkReads: true, local: vi.fn(async (action: () => Promise<unknown>) => {
    central.executing = true
    try { return await action() }
    finally { central.executing = false }
  }) }
  Object.assign(worker, { dispatch, central })
  await worker.codex({ id, action: { action: 'list' } })
  await worker.codex({ id, action: { action: 'networks', command: { type: 'list' } } })
  expect(central.local).not.toHaveBeenCalled()
  expect(dispatch).toHaveBeenLastCalledWith({ codex: { id, action: { action: 'networks', command: { type: 'list' } } }, ownerOperation: false })
  const request = { id, action: { action: 'run', podId: id, revision: 1 } }
  await worker.codex(request)
  expect(central.local).toHaveBeenCalledTimes(1)
  expect(dispatch).toHaveBeenLastCalledWith({ codex: request, ownerOperation: true })
  central.networkReads = false
  await expect(worker.codex({ id, action: { action: 'networks', command: { type: 'pause', id, revision: 1 } } })).rejects.toThrow('bounded relay')
})

it('sends desktop commands and approval page opening through the producers of the desktop window', async () => {
  const { FixtureWorker } = await import('../../src/main/worker')
  const worker = new FixtureWorker(() => {})
  const id = '00000000-0000-4000-8000-000000000001'
  const definitions = vi.spyOn(worker, 'definitions').mockResolvedValue({ definitions: [], instances: [], provisioning: [] })
  const scheduling = vi.spyOn(worker, 'scheduling').mockResolvedValue({} as never)
  const request = vi.spyOn(worker, 'request').mockResolvedValue({} as never)
  const health = { oldestPendingAt: null, nextRetryAt: null, lastDispatchAt: null, lastSchedulerProgressAt: null, lastSchedulerError: null, intakeError: null, lastFailure: null }
  const networks = vi.spyOn(worker, 'networks').mockResolvedValue({ networks: [{ id, revision: 1, groupId: id, name: 'Morning briefing', state: 'active', counts: {}, health }] })
  // The worker's administration journal: a completed request id returns its recorded result.
  const receipts = new Map<string, unknown>()
  const dispatch = vi.fn(async ({ codexAdministration: entry }: { codexAdministration: { type: string, request: { id: string }, result?: unknown } }) => {
    if (entry.type === 'complete') receipts.set(entry.request.id, entry.result)
    return receipts.has(entry.request.id) ? { completed: true, result: receipts.get(entry.request.id) } : { completed: false }
  })
  Object.assign(worker, { dispatch })
  const prepare = { type: 'prepareLocal', podId: id, expectedScript: 'a'.repeat(64), name: 'Editor', defaults: {} }
  const pauseAll = { id: randomUUID(), action: { action: 'desktop', channel: 'workspace', command: { type: 'pauseAll' } } }

  await worker.codex({ id: randomUUID(), action: { action: 'desktop', channel: 'definitions', command: prepare } })
  await worker.codex({ id: randomUUID(), action: { action: 'desktop', channel: 'scheduling', command: { type: 'concurrency', podId: id, maximum: 2 } } })
  await worker.codex(pauseAll)
  await worker.codex(pauseAll)
  await worker.codex({ id: randomUUID(), action: { action: 'desktop', channel: 'workspace', command: { type: 'list' } } })
  const opened = await worker.codex({ id, action: { action: 'networks', command: { type: 'gateOpen', id, revision: 1, taskId: id, generation: 1 } } })

  expect(definitions).toHaveBeenCalledWith(prepare)
  expect(scheduling).toHaveBeenCalledWith({ type: 'concurrency', podId: id, maximum: 2 })
  expect(request.mock.calls).toEqual([[{ type: 'pauseAll' }], [{ type: 'list' }]])
  expect(dispatch.mock.calls.filter(([command]) => command.codexAdministration.type === 'begin')).toHaveLength(4)
  expect(networks).toHaveBeenCalledWith({ type: 'gateOpen', id, revision: 1, taskId: id, generation: 1 })
  expect(opened).toMatchObject({ networks: [{ id, state: 'active' }] })
  await expect(worker.codex({ id, action: { action: 'desktop', channel: 'runtimeApproval', command: { type: 'set', enabled: true } } })).rejects.toThrow('Unsupported desktop MCP channel')
})
