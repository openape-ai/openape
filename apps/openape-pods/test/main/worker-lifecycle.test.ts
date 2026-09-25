// @vitest-environment node
import { expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() }, safeStorage: {}, app: { getPath: () => '/nonexistent' } }))

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
