// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { approveMailGrants } from '../../src/main/connections/grants'
import { PodIdentityManager } from '../../src/main/connections/agent'
import { CredentialCache } from '../../src/main/connections/cache'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
it.each(['pending', 'approved'])('uses agent identity to request scoped grants and handles %s permission responses', async (state) => {
  const id = randomUUID(); const requests: { url: string, body: Record<string, unknown>, bearer: string | null }[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(init.body as string), bearer: new Headers(init.headers).get('Authorization') })
    if (url.endsWith('/api/grants')) return Response.json({ id, status: state })
    if (state === 'approved') return Response.json({ error: 'Grant is not pending' }, { status: 400 })
    return Response.json({ grant: { id, status: 'approved' } })
  }))
  const identities = new PodIdentityManager(new CredentialCache('unused', { available: () => false, encrypt: () => Buffer.alloc(0), decrypt: () => '' }))
  const podId = randomUUID(); const issuer = 'https://identity.example.invalid'
  vi.spyOn(identities, 'connection').mockReturnValue({ issuer, subject: 'agent@example.invalid', owner: 'owner@example.invalid', keyId: 'key', targetHost: `pods:${podId}`, accessToken: async () => 'SYNTHETIC_AGENT' })
  const setup = { podId, revision: 1, ownerConnection: randomUUID(), mailConnection: randomUUID(), account: 'mail@example.invalid', folders: [{ id: 'inbox', name: 'Inbox' }, { id: 'rules', name: 'Orders' }], attachments: false, since: null }
  const reference = { connectionId: randomUUID(), podId, issuer, owner: 'owner@example.invalid', subject: 'agent@example.invalid', keyId: 'key' }
  expect(await approveMailGrants(setup, reference, identities, 'SYNTHETIC_OWNER', resolve('runtime-sources'), new AbortController().signal)).toEqual({ messages: id })
  expect(requests[0].bearer).toBe('Bearer SYNTHETIC_AGENT'); expect(requests[0].body.requester).toBe(reference.subject)
  expect(requests[0].body.authorization_details).toHaveLength(2)
  expect(JSON.stringify(requests[0].body)).not.toContain('SYNTHETIC_OWNER')
  expect(requests).toHaveLength(state === 'pending' ? 2 : 1)
  if (state === 'pending') expect(requests[1].bearer).toBe('Bearer SYNTHETIC_OWNER')
})
