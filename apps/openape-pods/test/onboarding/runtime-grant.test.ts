// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { approveRuntimeGrant } from '../../src/main/connections/runtime-grant'

afterEach(() => vi.unstubAllGlobals())
const podId = '00000000-0000-4000-8000-000000000001'
const permission = `pod-runtime.pod[id=${podId}]#run`
const connection = { issuer: 'https://agents.example.test', decisionIssuer: 'https://owner.example.test', subject: 'pod@agents.example.test', owner: 'original@example.test', targetHost: `pods:${podId}`, keyId: 'key', accessToken: async () => 'AGENT_TOKEN' }
function fixture() {
  const grant = { id: 'grant-1', status: 'pending', request: { requester: connection.subject, audience: 'shapes', target_host: connection.targetHost, grant_type: 'always', permissions: [permission], authorization_details: [{ type: 'openape_cli', cli_id: 'pod-runtime', operation_id: 'run', action: 'run', permission, resource_chain: [{ resource: 'pod', selector: { id: podId } }] }] } }
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => Response.json(init?.method === 'POST' ? { grant: { id: grant.id, status: 'approved' } } : grant))
  vi.stubGlobal('fetch', fetcher)
  return { grant, fetcher }
}
const approve = (allowed = () => true) => approveRuntimeGrant(connection, podId, 'grant-1', 'ORIGINAL_OWNER_TOKEN', new AbortController().signal, allowed)

it('checks and approves only at the original decision IdP with the owner bearer', async () => {
  const { fetcher } = fixture()
  await approve()
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['https://owner.example.test/api/grants/grant-1', 'https://owner.example.test/api/grants/grant-1/approve'])
  for (const [, init] of fetcher.mock.calls) expect(init?.headers).toMatchObject({ Authorization: 'Bearer ORIGINAL_OWNER_TOKEN' })
})

it.each(['denied', 'revoked', 'expired', 'used'])('never approves a %s grant', async (status) => {
  const { grant, fetcher } = fixture(); grant.status = status
  await expect(approve()).rejects.toThrow(status)
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it.each(['requester', 'target_host', 'grant_type', 'audience'] as const)('rejects a changed %s binding', async (key) => {
  const { grant, fetcher } = fixture(); grant.request[key] = 'foreign'
  await expect(approve()).rejects.toThrow('exact runtime permission')
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('rejects additional permissions, a changed resource and a disabled preference before approval', async () => {
  let f = fixture(); f.grant.request.permissions.push('mail.messages#read')
  await expect(approve()).rejects.toThrow('exact runtime permission')
  expect(f.fetcher).toHaveBeenCalledTimes(1)
  f = fixture(); f.grant.request.authorization_details[0]!.resource_chain[0]!.selector.id = 'another-pod'
  await expect(approve()).rejects.toThrow('exact runtime permission')
  expect(f.fetcher).toHaveBeenCalledTimes(1)
  f = fixture()
  await expect(approve(() => false)).rejects.toThrow('disabled')
  expect(f.fetcher).toHaveBeenCalledTimes(1)
})
