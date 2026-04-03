import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveTXT } from '../dns/doh.js'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

beforeEach(() => {
  fetchMock.mockReset()
})

describe('resolveTXT (DoH)', () => {
  it('resolves TXT records from successful response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        Answer: [
          { type: 16, data: '"v=ddisa1 idp=https://idp.example.com"' },
          { type: 16, data: '"some-other-record"' },
        ],
      }),
    })

    const result = await resolveTXT('example.com')
    expect(result).toEqual([
      'v=ddisa1 idp=https://idp.example.com',
      'some-other-record',
    ])

    expect(fetchMock).toHaveBeenCalledOnce()
    const url = fetchMock.mock.calls[0]![0] as string
    expect(url).toContain('type=TXT')
    expect(url).toContain('name=example.com')
  })

  it('returns empty array when no Answer field', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    })

    const result = await resolveTXT('empty.com')
    expect(result).toEqual([])
  })

  it('returns empty array when Answer is empty', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ Answer: [] }),
    })

    const result = await resolveTXT('empty.com')
    expect(result).toEqual([])
  })

  it('throws on non-OK HTTP response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
    })

    await expect(resolveTXT('fail.com')).rejects.toThrow('DoH request failed: 503')
  })

  it('filters out non-TXT record types', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        Answer: [
          { type: 1, data: '1.2.3.4' }, // A record
          { type: 16, data: '"txt-value"' }, // TXT record
          { type: 28, data: '::1' }, // AAAA record
        ],
      }),
    })

    const result = await resolveTXT('mixed.com')
    expect(result).toEqual(['txt-value'])
  })

  it('strips surrounding quotes from TXT data', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        Answer: [
          { type: 16, data: '"quoted-value"' },
          { type: 16, data: 'unquoted-value' },
        ],
      }),
    })

    const result = await resolveTXT('quotes.com')
    expect(result).toEqual(['quoted-value', 'unquoted-value'])
  })

  it('uses custom provider when specified', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ Answer: [] }),
    })

    await resolveTXT('example.com', 'https://custom-dns.example.com/resolve')
    const url = fetchMock.mock.calls[0]![0] as string
    expect(url).toMatch(/^https:\/\/custom-dns\.example\.com\/resolve/)
  })
})
