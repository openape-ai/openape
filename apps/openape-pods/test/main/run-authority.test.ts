// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { AuthorityError } from '../../src/contracts/infrastructure'
import { runAuthorityWatchMs } from '../../src/contracts/services'
import type { ServiceRequest } from '../../src/contracts/services'

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), assertActive: vi.fn() }))
vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() }, safeStorage: {}, app: { getPath: () => '/nonexistent', isPackaged: false }, shell: { openExternal: vi.fn(async () => {}) } }))
vi.mock('../../src/main/broker/authorization', async importOriginal => ({ ...await importOriginal<object>(), AgentAuthority: class { authorize = mocks.authorize; assertActive = mocks.assertActive } }))
// The watch waits with timers/promises, which fake timers do not replace on their own.
vi.mock('node:timers/promises', () => ({ setTimeout: async (ms: number, value: unknown, options?: { signal?: AbortSignal }) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms, value)
  options?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(options.signal!.reason) }, { once: true })
}) }))
vi.mock('@openape/apes', () => ({ loadAdapter: () => ({ digest: 'digest' }), resolveCommand: async () => ({ permission: 'pod-runtime' }) }))
vi.mock('../../src/runtime/environment', () => ({ podEnvironment: async () => ({ workspace: '/fixture/workspace', home: '/fixture/home', environment: {} }), podEnvironmentValues: () => ({}), visibleEnvironment: () => ({}) }))
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks() })

const podId = '00000000-0000-4000-8000-000000000001'
const runId = '00000000-0000-4000-8000-000000000002'
const scope = { podId, runId, epoch: 0, assignmentRevision: 1, capabilities: [] }
let requests = 0
const request = (kind: ServiceRequest['kind'], body: unknown = {}): ServiceRequest => ({ id: `00000000-0000-4000-8000-${String(++requests).padStart(12, '0')}`, kind, scope, body })

async function fixture(runtime = true) {
  const { FixtureWorker } = await import('../../src/main/worker')
  const worker = new FixtureWorker(() => {})
  const dispatched: Record<string, unknown>[] = []
  const dispatch = vi.fn(async (command: Record<string, unknown>) => {
    dispatched.push(command)
    if ('runContext' in command) return { name: 'Synthetic Pod', reason: 'schedule', runtime }
    if ('credentialCheck' in command) return 'secret-id'
    return { resources: [], epoch: 0 }
  })
  const credentials = { readScriptSecret: vi.fn(async () => 'SYNTHETIC_SECRET') }
  Object.assign(worker, { root: '/fixture', credentials, connections: { podConnection: async () => ({}) }, dispatch })
  const service = worker as unknown as { executeService: (request: ServiceRequest) => Promise<unknown> }
  return { service, credentials, dispatched }
}

it('refuses a credential read of a run whose runtime authority is not active and never reads the secret', async () => {
  const f = await fixture()
  await expect(f.service.executeService(request('credential', { alias: 'api_key' }))).rejects.toThrow(AuthorityError)
  expect(f.credentials.readScriptSecret).not.toHaveBeenCalled()
  expect(f.dispatched.some(command => 'credentialCheck' in command)).toBe(false)
})

it('re-verifies the runtime grant before a credential read and refuses it once the grant is revoked', async () => {
  const f = await fixture()
  await f.service.executeService(request('shell'))
  await expect(f.service.executeService(request('credential', { alias: 'api_key' }))).resolves.toBe('SYNTHETIC_SECRET')
  mocks.authorize.mockRejectedValueOnce(new AuthorityError('Permission revoked; review this Pod\'s permissions before retrying'))
  await expect(f.service.executeService(request('credential', { alias: 'api_key' }))).rejects.toThrow('revoked')
  expect(f.credentials.readScriptSecret).toHaveBeenCalledTimes(1)
  await f.service.executeService(request('shellClose'))
})

it('lets runs without a runtime (network, decision maintenance) proceed, but never starts a runtime for them', async () => {
  const f = await fixture(false)
  await expect(f.service.executeService(request('shell'))).rejects.toThrow('unavailable')
  expect(mocks.authorize).not.toHaveBeenCalled()
})

it('cancels a running run within the watch interval after its runtime grant is revoked', async () => {
  vi.useFakeTimers()
  const f = await fixture()
  await f.service.executeService(request('shell'))
  expect(mocks.assertActive).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(runAuthorityWatchMs)
  expect(mocks.assertActive).toHaveBeenCalledTimes(1)
  expect(f.dispatched.some(command => (command.serviceCheck as { authorityLost?: true } | undefined)?.authorityLost)).toBe(false)
  mocks.assertActive.mockRejectedValueOnce(new AuthorityError('Pod identity, key or grant is no longer active'))
  await vi.advanceTimersByTimeAsync(runAuthorityWatchMs)
  expect(f.dispatched.some(command => (command.serviceCheck as { authorityLost?: true } | undefined)?.authorityLost)).toBe(true)
  await f.service.executeService(request('shellClose'))
})
