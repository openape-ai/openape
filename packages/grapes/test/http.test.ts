import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/config', () => ({
  getIdpUrl: vi.fn(),
  getAuthToken: vi.fn(),
}))

const { getIdpUrl, getAuthToken } = await import('../src/config')
const { apiFetch, ApiError } = await import('../src/http')

describe('apiFetch', () => {
  const mockGetIdpUrl = vi.mocked(getIdpUrl)
  const mockGetAuthToken = vi.mocked(getAuthToken)

  beforeEach(() => {
    mockGetIdpUrl.mockReturnValue('https://id.example.com')
    mockGetAuthToken.mockReturnValue('test-token')
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('makes authenticated GET request', async () => {
    const mockFetch = vi.mocked(globalThis.fetch)
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: 'test' }),
    } as Response)

    const result = await apiFetch('/api/test')
    expect(result).toEqual({ data: 'test' })
    expect(mockFetch).toHaveBeenCalledWith(
      'https://id.example.com/api/test',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      }),
    )
  })

  it('makes POST request with body', async () => {
    const mockFetch = vi.mocked(globalThis.fetch)
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: '123' }),
    } as Response)

    await apiFetch('/api/grants', {
      method: 'POST',
      body: { type: 'command' },
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://id.example.com/api/grants',
      expect.objectContaining({
        method: 'POST',
        body: '{"type":"command"}',
      }),
    )
  })

  it('throws when no IdP URL', async () => {
    mockGetIdpUrl.mockReturnValue(null)
    await expect(apiFetch('/api/test')).rejects.toThrow('No IdP URL configured')
  })

  it('throws when not authenticated', async () => {
    mockGetAuthToken.mockReturnValue(null)
    await expect(apiFetch('/api/test')).rejects.toThrow('Not authenticated')
  })

  it('throws ApiError on non-ok response', async () => {
    const mockFetch = vi.mocked(globalThis.fetch)
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      headers: new Headers({ 'content-type': 'text/plain' }),
      text: () => Promise.resolve('Access denied'),
    } as Response)

    try {
      await apiFetch('/api/test')
      expect.unreachable('Should have thrown')
    }
    catch (err) {
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).statusCode).toBe(403)
    }
  })

  it('uses explicit idp and token', async () => {
    const mockFetch = vi.mocked(globalThis.fetch)
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    } as Response)

    await apiFetch('/api/test', {
      idp: 'https://custom.example.com',
      token: 'custom-token',
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://custom.example.com/api/test',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer custom-token',
        }),
      }),
    )
  })
})
