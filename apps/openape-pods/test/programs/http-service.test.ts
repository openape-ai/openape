// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { InfrastructureError } from '../../src/contracts/infrastructure'
import type { PodResource } from '../../src/contracts/resources'
import type { CredentialCache } from '../../src/main/connections/cache'
import { executeHttp } from '../../src/main/programs/http-service'

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), assertActive: vi.fn(), send: vi.fn() }))
vi.mock('../../src/main/broker/authorization', () => ({ AgentAuthority: class { authorize = mocks.authorize; assertActive = mocks.assertActive } }))
vi.mock('../../src/main/connections/agent', () => ({ PodIdentityManager: class { connection() { return {} } } }))
vi.mock('../../src/main/programs/http', () => ({ requestHttp: mocks.send }))
vi.mock('@openape/apes', () => ({ loadAdapter: () => ({ digest: 'digest' }), resolveCommand: async () => ({ permission: 'http' }) }))
afterEach(() => { vi.resetAllMocks() })
const podId = '00000000-0000-4000-8000-000000000001'
const scope = { podId, runId: podId, epoch: 1, assignmentRevision: 1, capabilities: ['tool.http_fixture.request'] }
const resources: PodResource[] = [{ id: podId, podId, revision: 1, kind: 'tool', state: 'ready', name: 'Fixture', configuration: { type: 'http', origin: 'https://example.com', methods: ['GET', 'POST'], capability: scope.capabilities[0], authority: { identity: { podId }, grantId: 'approved' } } }]
const failure = () => new InfrastructureError({ phase: 'authorization', retryAfterMs: 0 })
const execute = (method: string) => executeHttp(resources, scope, { url: 'https://example.com/send', method, headers: {}, ...(method === 'POST' ? { key: 'delivery:1' } : {}) }, '/unused', {} as CredentialCache, new AbortController().signal)

it('reports authorization outages as retryable only before a mutating request was sent', async () => {
  mocks.authorize.mockRejectedValueOnce(failure())
  await expect(execute('POST')).rejects.toBeInstanceOf(InfrastructureError)
  expect(mocks.send).not.toHaveBeenCalled()
  mocks.send.mockResolvedValue({ status: 200, headers: {}, body: '{}' })
  mocks.assertActive.mockRejectedValueOnce(failure())
  await expect(execute('POST')).rejects.toThrow('delivery may be uncertain')
  expect(mocks.send).toHaveBeenCalledTimes(1)
})
it('permits a read retry after transient authority loss but never retries a revoked grant', async () => {
  mocks.send.mockResolvedValue({ status: 200, headers: {}, body: '{}' })
  mocks.assertActive.mockRejectedValueOnce(failure())
  await expect(execute('GET')).rejects.toBeInstanceOf(InfrastructureError)
  mocks.authorize.mockRejectedValueOnce(new Error('Permission revoked'))
  await expect(execute('GET')).rejects.not.toBeInstanceOf(InfrastructureError)
  expect(mocks.send).toHaveBeenCalledTimes(1)
})
