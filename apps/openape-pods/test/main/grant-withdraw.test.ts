// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { withdrawGrantRequest } from '../../src/main/grants/withdraw'

const connection = { issuer: 'https://pods.example.test', accessToken: async () => 'pod-token' }
afterEach(() => { vi.unstubAllGlobals() })

it('withdraws at the Pod identity issuer with its own token and returns only a well-formed answer (issue 1536)', async () => {
  const fetch = vi.fn(async () => Response.json({ outcome: 'withdrawn', grant_id: 'grant-1', previous_status: 'approved' }))
  vi.stubGlobal('fetch', fetch)
  await expect(withdrawGrantRequest(connection, { reference: 'archive-v2:abc', reason: 'Mail left the Inbox' }, new AbortController().signal)).resolves.toEqual({ outcome: 'withdrawn', grant_id: 'grant-1', previous_status: 'approved' })
  expect(fetch).toHaveBeenCalledWith('https://pods.example.test/api/grants/withdraw', expect.objectContaining({ method: 'POST', redirect: 'error', headers: expect.objectContaining({ Authorization: 'Bearer pod-token' }), body: JSON.stringify({ reference: 'archive-v2:abc', reason: 'Mail left the Inbox' }) }))
})

it.each([
  [404, {}, 'does not support withdrawing'],
  [501, { title: 'unsupported' }, 'deciding identity provider does not support'],
  [403, { title: 'inactive' }, 'rejected the request (403)'],
  [200, { outcome: 'withdrawn', grant_id: 'grant-1' }, 'Invalid grant withdrawal answer'],
])('reports HTTP %s with a clear cause instead of a success', async (status, body, message) => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(body, { status })))
  await expect(withdrawGrantRequest(connection, { reference: 'archive-v2:abc' }, new AbortController().signal)).rejects.toThrow(message)
})
