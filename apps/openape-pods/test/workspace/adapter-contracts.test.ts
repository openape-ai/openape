import { afterEach, expect, it, vi } from 'vitest'
import { browserWorkspaceClient, desktopWorkspaceClient, WorkspaceRequestError } from '../../src/renderer/central/client'
import { remotePodAccess } from '../../src/renderer/central/remote-pod-access'
import { localWorkspaceAccess } from '../../src/renderer/workspace-access'
import { createDemoAdapter } from '../../src/renderer/demo/adapter'
import { centralFixture } from './central-fixture'
import type { CentralOperation } from '../../src/contracts/central'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

it('forwards supported workspace commands through the actual Electron adapter without changing revisions', async () => {
  const demo = createDemoAdapter('everyday')
  try {
    const scheduling = vi.spyOn(demo.bridge, 'scheduling')
    const domain = vi.spyOn(demo.bridge, 'domain')
    const access = localWorkspaceAccess(demo.bridge)
    const body = { type: 'lifecycle' as const, podId: '00000000-0000-4000-8000-000000000001', revision: 1, lifecycle: 'paused' as const }
    await access.command({ channel: 'scheduling', body })
    expect(scheduling).toHaveBeenCalledExactlyOnceWith(body)
    await access.domain!({ type: 'answer', questionId: 'demo-question-1', option: 'keep' })
    expect(domain).toHaveBeenCalledExactlyOnceWith({ type: 'answer', questionId: 'demo-question-1', option: 'keep' })
    await expect(access.command({ channel: 'data', body: { type: 'cleanup' } })).rejects.toThrow('Unsupported workspace channel')
  }
  finally { demo.dispose() }
})

it('preserves the authenticated backend transport and its exact command envelope', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ id: 'request-1', state: 'applied' }), { status: 200 }))
  vi.stubGlobal('fetch', fetch)
  const client = browserWorkspaceClient()
  const request = { channel: 'details' as const, body: { type: 'describe', podId: 'pod-1', revision: 7, text: 'Changed purpose' } }
  await client.command('runtime-1', 12, request, 'request-1')
  expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/workspace/v1/commands', {
    credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: undefined,
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ runtimeId: 'runtime-1', revision: 12, command: request, id: 'request-1' }),
  })
  fetch.mockImplementationOnce(async () => new Response(JSON.stringify({ code: 'authentication_required' }), { status: 401 }))
  await expect(client.session()).rejects.toMatchObject({ status: 401, message: 'authentication_required' })
})

it('uses the real desktop client envelope and propagates bridge errors', async () => {
  const bridge = vi.fn(async (_request: Record<string, unknown>): Promise<unknown> => ({ revision: 4, map: null }))
  const client = desktopWorkspaceClient(bridge)
  expect(await client.map!('runtime-1')).toEqual({ revision: 4, map: null })
  expect(bridge).toHaveBeenCalledExactlyOnceWith({ type: 'read', runtimeId: 'runtime-1', view: 'map' })
  bridge.mockResolvedValueOnce({ requestError: { status: 409, message: 'Revision conflict' } })
  await expect(client.command('runtime-1', 4, { channel: 'workspace', body: { type: 'pauseAll' } }, 'request-1')).rejects.toBeInstanceOf(WorkspaceRequestError)
  expect(bridge).toHaveBeenLastCalledWith({ type: 'submit', runtimeId: 'runtime-1', revision: 4, command: { channel: 'workspace', body: { type: 'pauseAll' } }, id: 'request-1' })
})

it.each(['unknown', 'lost'] as const)('keeps uncertain backend writes fenced after %s outcomes', async (outcome) => {
  const fixture = centralFixture()
  const initial = await fixture.client.read(fixture.host.id, fixture.view.id)
  const command = vi.spyOn(fixture.client, 'command').mockImplementation(async (_host, _revision, request, id) => {
    if (outcome === 'lost') throw new TypeError('Acknowledgement lost')
    return { id, runtimeId: fixture.host.id, command: request, state: 'unknown', result: null, error: 'Unknown outcome', revision: 1 }
  })
  const remote = remotePodAccess(fixture.client, () => fixture.host, initial, new AbortController().signal)
  const body = { type: 'describe' as const, podId: fixture.view.id, revision: 0, text: 'Keep this edit' }
  await expect(remote.access.api.details(body)).rejects.toThrow()
  expect(remote.state.operation).toBeTruthy()
  await expect(remote.access.api.details(body)).rejects.toThrow('Review the pending operation')
  expect(command).toHaveBeenCalledOnce()
})

it('waits for backend confirmation, refreshes the shared view and releases failed operations', async () => {
  vi.useFakeTimers()
  const fixture = centralFixture()
  const initial = await fixture.client.read(fixture.host.id, fixture.view.id)
  let operation: CentralOperation
  const command = vi.spyOn(fixture.client, 'command').mockImplementation(async (_host, _revision, request, id) => {
    operation = { id, runtimeId: fixture.host.id, command: request, state: 'applied', result: { ...fixture.view.details, description: { text: 'Confirmed purpose', revision: 1, state: 'ready', error: null, updatedAt: Date.now() } }, error: null, revision: 2 }
    fixture.view.details = operation.result as typeof fixture.view.details
    return { ...operation, state: 'accepted', result: null }
  })
  fixture.client.operation = async () => operation
  const remote = remotePodAccess(fixture.client, () => fixture.host, initial, new AbortController().signal)
  const saving = remote.access.api.details({ type: 'describe', podId: fixture.view.id, revision: 0, text: 'Confirmed purpose' })
  await vi.advanceTimersByTimeAsync(500)
  expect((await saving).description?.text).toBe('Confirmed purpose')
  expect(remote.summary.value.pod.details.description?.text).toBe('Confirmed purpose')
  expect(remote.state.operation).toBe('')
  command.mockImplementationOnce(async (_host, _revision, request, id) => ({ id, runtimeId: fixture.host.id, command: request, state: 'failed', result: null, error: 'Revision conflict', revision: 2 }))
  await expect(remote.access.api.details({ type: 'describe', podId: fixture.view.id, revision: 0, text: 'Stale edit' })).rejects.toThrow('Revision conflict')
  expect(remote.state.operation).toBe('')
})
