// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { AuthorityError, InfrastructureError } from '../../src/contracts/infrastructure'
import type { PodResource } from '../../src/contracts/resources'
import type { CredentialCache } from '../../src/main/connections/cache'
import { executeHttp } from '../../src/main/programs/http-service'

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), assertActive: vi.fn(), send: vi.fn() }))
vi.mock('../../src/main/broker/authorization', () => ({ AgentAuthority: class { authorize = mocks.authorize; assertActive = mocks.assertActive } }))
vi.mock('../../src/main/connections/agent', () => ({ PodIdentityManager: class { connection() { return {} } } }))
vi.mock('../../src/main/programs/http', () => ({ requestHttp: mocks.send }))
vi.mock('@openape/apes', () => ({ loadAdapter: () => ({ digest: 'digest' }), resolveCommand: async () => ({ permission: 'http' }) }))
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers() })
const podId = '00000000-0000-4000-8000-000000000001'
const scope = { podId, runId: podId, epoch: 1, assignmentRevision: 1, capabilities: ['tool.http_fixture.request'] }
const resources: PodResource[] = [{ id: podId, podId, revision: 1, kind: 'tool', state: 'ready', name: 'Fixture', configuration: { type: 'http', origin: 'https://example.com', methods: ['GET', 'POST'], capability: scope.capabilities[0], authority: { identity: { podId }, grantId: 'approved' } } }]
const failure = () => new InfrastructureError({ phase: 'authorization', retryAfterMs: 0 })
const execute = (method: string) => executeHttp(resources, scope, { url: 'https://example.com/send', method, headers: {}, ...(method === 'POST' ? { key: 'delivery:1' } : {}) }, '/unused', {} as CredentialCache, new AbortController().signal)

it('sends nothing when the IdP grant is unavailable or refused', async () => {
  mocks.authorize.mockRejectedValueOnce(failure())
  await expect(execute('POST')).rejects.toBeInstanceOf(InfrastructureError)
  mocks.authorize.mockRejectedValueOnce(new AuthorityError('Permission revoked; review this Pod\'s permissions before retrying'))
  await expect(execute('POST')).rejects.toThrow('revoked')
  mocks.authorize.mockRejectedValueOnce(new Error('Grant does not cover required permission: http'))
  await expect(execute('GET')).rejects.toThrow('does not cover')
  expect(mocks.send).not.toHaveBeenCalled()
})

it('authorizes each request once and does not poll the grant while it is in flight', async () => {
  vi.useFakeTimers()
  let respond: (reply: unknown) => void = () => {}
  mocks.send.mockReturnValue(new Promise((resolve) => { respond = resolve }))
  const work = execute('POST')
  await vi.advanceTimersByTimeAsync(5000)
  respond({ status: 200, headers: {}, body: '{}' })
  await expect(work).resolves.toMatchObject({ status: 200 })
  expect(mocks.authorize).toHaveBeenCalledTimes(1)
  expect(mocks.assertActive).not.toHaveBeenCalled()
})

it('does not send a POST when the destination agent token cannot be minted', async () => {
  const authentication = { type: 'ddisaAgent', credential: 'agent_key', subject: 'agent@example.com', issuer: 'https://id.example.com' }
  const assigned = resources.map(resource => ({ ...resource, configuration: { ...resource.configuration, authentication } }))
  const work = executeHttp(assigned, scope, { url: 'https://example.com/send', method: 'POST', headers: {}, key: 'delivery:1' }, '/unused', {} as CredentialCache, new AbortController().signal, undefined, undefined, { token: async () => { throw failure() }, reject: () => {} })
  await expect(work).rejects.toBeInstanceOf(InfrastructureError)
  expect(mocks.send).not.toHaveBeenCalled()
})
