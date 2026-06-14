import { afterEach, describe, expect, it, vi } from 'vitest'
import { GrantsClient } from '../src/grants-client'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GrantsClient.findExistingGrant', () => {
  it('returns null when the grants API request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
    }))

    const client = new GrantsClient('https://idp.example.com/')

    await expect(client.findExistingGrant('qa@example.com', 'api.example.com', 'openape')).resolves.toBeNull()
  })

  it('ignores once grants even when otherwise matching', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          status: 'approved',
          expires_at: Math.floor(Date.now() / 1000) + 60,
          request: {
            grant_type: 'once',
            target_host: 'api.example.com',
            audience: 'openape',
            permissions: ['read'],
          },
        },
      ],
    }))

    const client = new GrantsClient('https://idp.example.com')

    await expect(client.findExistingGrant('qa@example.com', 'api.example.com', 'openape', ['read'])).resolves.toBeNull()
  })

  it('accepts a grant when requested permissions are omitted and the host and audience match', async () => {
    const grant = {
      status: 'approved',
      expires_at: Math.floor(Date.now() / 1000) + 60,
      request: {
        grant_type: 'standing',
        target_host: 'api.example.com',
        audience: 'openape',
        permissions: ['read'],
      },
    }

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [grant],
    }))

    const client = new GrantsClient('https://idp.example.com')

    await expect(client.findExistingGrant('qa@example.com', 'api.example.com', 'openape')).resolves.toBe(grant)
  })

  it('rejects grants missing any requested permission', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          status: 'approved',
          expires_at: Math.floor(Date.now() / 1000) + 60,
          request: {
            grant_type: 'standing',
            target_host: 'api.example.com',
            audience: 'openape',
            permissions: ['read'],
          },
        },
      ],
    }))

    const client = new GrantsClient('https://idp.example.com')

    await expect(client.findExistingGrant('qa@example.com', 'api.example.com', 'openape', ['read', 'write'])).resolves.toBeNull()
  })

  it('sends the bearer token when polling for existing grants after setAgentToken', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = new GrantsClient('https://idp.example.com')
    client.setAgentToken('agent-token')

    await client.findExistingGrant('qa@example.com', 'api.example.com', 'openape')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://idp.example.com/api/grants?requester=qa%40example.com&status=approved',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer agent-token',
          'Content-Type': 'application/json',
        }),
      }),
    )
  })
})
