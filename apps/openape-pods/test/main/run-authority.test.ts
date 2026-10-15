// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { AuthorityError } from '../../src/contracts/infrastructure'
import type { ServiceRequest } from '../../src/contracts/services'

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), refresh: vi.fn(), assertActive: vi.fn(), identityActive: vi.fn(), close: vi.fn() }))
vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() }, safeStorage: {}, app: { getPath: () => '/nonexistent', isPackaged: false }, shell: { openExternal: vi.fn(async () => {}) } }))
vi.mock('../../src/main/broker/authorization', async importOriginal => ({ ...await importOriginal<object>(), AgentAuthority: class { authorize = mocks.authorize; refresh = mocks.refresh; assertActive = mocks.assertActive } }))
vi.mock('../../src/main/connections/identity-file', () => ({ podIdentityFile: async () => ({ path: '/fixture/auth.json', assertActive: mocks.identityActive, close: mocks.close }) }))
vi.mock('@openape/apes', () => ({ loadAdapter: () => ({ digest: 'digest' }), resolveCommand: async () => ({ permission: 'pod-runtime' }) }))
vi.mock('../../src/main/grants/registry-copies', () => ({ loadPodAdapter: () => ({ digest: 'digest' }) }))
vi.mock('../../src/runtime/environment', () => ({ podEnvironment: async () => ({ workspace: '/fixture/workspace', home: '/fixture/home', environment: {} }), podEnvironmentValues: () => ({}), visibleEnvironment: () => ({}) }))
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks() })

const podId = '00000000-0000-4000-8000-000000000001'
const runId = '00000000-0000-4000-8000-000000000002'
const scope = { podId, runId, epoch: 0, assignmentRevision: 1, capabilities: [] }
let requests = 0
const request = (kind: ServiceRequest['kind'], body: unknown = {}): ServiceRequest => ({ id: `00000000-0000-4000-8000-${String(++requests).padStart(12, '0')}`, kind, scope, body })

async function fixture() {
  const { FixtureWorker } = await import('../../src/main/worker')
  const worker = new FixtureWorker(() => {})
  const dispatched: Record<string, unknown>[] = []
  const dispatch = vi.fn(async (command: Record<string, unknown>) => {
    dispatched.push(command)
    if ('runContext' in command) return { name: 'Synthetic Pod', reason: 'schedule' }
    if ('credentialCheck' in command) return 'secret-id'
    return { resources: [], epoch: 0 }
  })
  const credentials = { readScriptSecret: vi.fn(async () => 'SYNTHETIC_SECRET') }
  Object.assign(worker, { root: '/fixture', credentials, connections: { podConnection: async () => ({ issuer: 'https://id.example.test', targetHost: 'pods:fixture' }) }, dispatch })
  const service = worker as unknown as { executeService: (request: ServiceRequest) => Promise<unknown> }
  return { service, credentials, dispatched }
}

it('refuses a credential read of a run whose runtime authority is not active and never reads the secret', async () => {
  const f = await fixture()
  await expect(f.service.executeService(request('credential', { alias: 'api_key' }))).rejects.toThrow(AuthorityError)
  expect(f.credentials.readScriptSecret).not.toHaveBeenCalled()
  expect(f.dispatched.some(command => 'credentialCheck' in command)).toBe(false)
})

it('re-checks the assigned identity before credentials and cancels the run when refresh fails', async () => {
  const f = await fixture()
  await f.service.executeService(request('shell'))
  await expect(f.service.executeService(request('credential', { alias: 'api_key' }))).resolves.toBe('SYNTHETIC_SECRET')
  expect(mocks.identityActive).toHaveBeenCalledTimes(1)
  mocks.identityActive.mockImplementationOnce(() => { throw new AuthorityError('Pod identity expired') })
  await expect(f.service.executeService(request('credential', { alias: 'api_key' }))).rejects.toThrow('expired')
  expect(f.credentials.readScriptSecret).toHaveBeenCalledTimes(1)
  expect(mocks.authorize).not.toHaveBeenCalled()
  expect(f.dispatched.some(command => (command.serviceCheck as { authorityLost?: true } | undefined)?.authorityLost)).toBe(true)
  await f.service.executeService(request('shellClose'))
  expect(mocks.close).toHaveBeenCalledTimes(1)
})

// Actual identity and grant revocation terminate the native process domain in e2e/ape-shell-machine.test.ts.
it('delegates execution approval to ape-shell and removes its identity on close', async () => {
  const f = await fixture()
  const prepared = await f.service.executeService(request('shell'))
  expect(prepared).toMatchObject({ machine: { targetHost: 'pods:fixture', issuer: 'https://id.example.test', runtime: { environment: { APES_AUTH_FILE: '/fixture/auth.json', APES_IGNORE_USER_CONFIG: '1' } } } })
  expect(mocks.authorize).not.toHaveBeenCalled()
  expect(mocks.refresh).not.toHaveBeenCalled()
  expect(mocks.assertActive).not.toHaveBeenCalled()
  await f.service.executeService(request('shellClose'))
  expect(mocks.close).toHaveBeenCalledTimes(1)
  await expect(f.service.executeService(request('credential', { alias: 'api_key' }))).rejects.toThrow(AuthorityError)
})
