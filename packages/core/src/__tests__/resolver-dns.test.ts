import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveTXT } from '../dns/node.js'
import { clearDNSCache, resolveDDISA } from '../dns/resolver.js'

// Mock the node DNS resolver (resolver.ts tries node first, falls back to DoH)
vi.mock('../dns/node.js', () => ({
  resolveTXT: vi.fn(),
}))

const mockResolveTXT = vi.mocked(resolveTXT)

afterEach(() => {
  clearDNSCache()
  mockResolveTXT.mockReset()
})

describe('resolveDDISA with DNS resolution', () => {
  it('parses DDISA records from DNS TXT records', async () => {
    mockResolveTXT.mockResolvedValueOnce([
      'v=ddisa1 idp=https://idp.example.com; mode=open',
    ])

    const record = await resolveDDISA('dns-test.com', { noCache: true })
    expect(record).toMatchObject({
      version: 'ddisa1',
      idp: 'https://idp.example.com',
      mode: 'open',
    })
    expect(mockResolveTXT).toHaveBeenCalledWith('_ddisa.dns-test.com')
  })

  it('returns null when no valid DDISA records found', async () => {
    mockResolveTXT.mockResolvedValueOnce([
      'some-other-txt-record',
      'v=spf1 include:example.com',
    ])

    const record = await resolveDDISA('no-ddisa.com', { noCache: true })
    expect(record).toBeNull()
  })

  it('returns null when DNS returns empty array', async () => {
    mockResolveTXT.mockResolvedValueOnce([])

    const record = await resolveDDISA('empty-dns.com', { noCache: true })
    expect(record).toBeNull()
  })

  it('caches results and uses cache on second call', async () => {
    mockResolveTXT.mockResolvedValueOnce([
      'v=ddisa1 idp=https://idp.cached.com; mode=open',
    ])

    const result1 = await resolveDDISA('cache-test.com')
    expect(result1?.idp).toBe('https://idp.cached.com')
    expect(mockResolveTXT).toHaveBeenCalledTimes(1)

    // Second call should use cache — not calling DNS again
    const result2 = await resolveDDISA('cache-test.com')
    expect(result2?.idp).toBe('https://idp.cached.com')
    expect(mockResolveTXT).toHaveBeenCalledTimes(1)
  })

  it('bypasses cache with noCache option', async () => {
    mockResolveTXT.mockResolvedValue([
      'v=ddisa1 idp=https://idp.nocache.com; mode=open',
    ])

    await resolveDDISA('nocache-test.com')
    expect(mockResolveTXT).toHaveBeenCalledTimes(1)

    await resolveDDISA('nocache-test.com', { noCache: true })
    expect(mockResolveTXT).toHaveBeenCalledTimes(2)
  })

  it('selects record with lowest priority', async () => {
    mockResolveTXT.mockResolvedValueOnce([
      'v=ddisa1 idp=https://backup.example.com; priority=20',
      'v=ddisa1 idp=https://primary.example.com; priority=5',
      'v=ddisa1 idp=https://secondary.example.com; priority=10',
    ])

    const record = await resolveDDISA('priority-test.com', { noCache: true })
    expect(record?.idp).toBe('https://primary.example.com')
    expect(record?.priority).toBe(5)
  })

  it('uses default priority 10 when not specified in records', async () => {
    mockResolveTXT.mockResolvedValueOnce([
      'v=ddisa1 idp=https://no-priority.example.com',
      'v=ddisa1 idp=https://low-priority.example.com; priority=5',
    ])

    const record = await resolveDDISA('default-priority.com', { noCache: true })
    // low-priority has priority=5, no-priority has default=10
    // 5 < 10, so low-priority wins
    expect(record?.idp).toBe('https://low-priority.example.com')
  })

  it('skips non-ddisa TXT records in the parsing loop', async () => {
    mockResolveTXT.mockResolvedValueOnce([
      'not-a-ddisa-record',
      'v=ddisa1 idp=https://valid.com; mode=open',
      'also-not-ddisa',
    ])

    const record = await resolveDDISA('mixed-records.com', { noCache: true })
    expect(record?.idp).toBe('https://valid.com')
  })

  it('skips ddisa records that fail parsing', async () => {
    mockResolveTXT.mockResolvedValueOnce([
      'v=ddisa1', // has v=ddisa1 but no idp — parseDDISARecord returns null
      'v=ddisa1 idp=https://valid.com; mode=open',
    ])

    const record = await resolveDDISA('bad-record.com', { noCache: true })
    expect(record?.idp).toBe('https://valid.com')
  })

  it('uses custom cacheTTL', async () => {
    mockResolveTXT.mockResolvedValue([
      'v=ddisa1 idp=https://ttl.example.com',
    ])

    await resolveDDISA('ttl-test.com', { cacheTTL: 1 })
    expect(mockResolveTXT).toHaveBeenCalledTimes(1)

    // Should still be cached (within 1 second)
    await resolveDDISA('ttl-test.com')
    expect(mockResolveTXT).toHaveBeenCalledTimes(1)
  })

  it('falls back to DoH when native DNS throws', async () => {
    // Simulate edge/browser runtime where node:dns is unavailable
    mockResolveTXT.mockRejectedValueOnce(new Error('not implemented'))

    const record = await resolveDDISA('doh-fallback.com', {
      noCache: true,
      dohProvider: 'https://cloudflare-dns.com/dns-query',
    })

    // DoH will try a real DNS lookup for _ddisa.doh-fallback.com — expect null (no record)
    // The important thing is that it doesn't throw
    expect(record).toBeNull()
    expect(mockResolveTXT).toHaveBeenCalledTimes(1)
  })
})
