import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveTXT } from '../dns/node.js'
import { clearDNSCache, clearDNSCacheFor, resolveDDISA } from '../dns/resolver.js'

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
    mockResolveTXT.mockResolvedValueOnce(['v=ddisa1 idp=https://idp.example.com; mode=open'])
    const record = await resolveDDISA('dns-test.com', { noCache: true })
    expect(record).toMatchObject({ idp: 'https://idp.example.com', mode: 'open' })
    expect(mockResolveTXT).toHaveBeenCalledWith('_ddisa.dns-test.com')
  })

  it('returns null when no valid DDISA records found', async () => {
    mockResolveTXT.mockResolvedValueOnce(['not-ddisa', 'v=spf1 include:x'])
    expect(await resolveDDISA('no-ddisa.com', { noCache: true })).toBeNull()
  })

  it('caches results and respects noCache', async () => {
    mockResolveTXT.mockResolvedValue(['v=ddisa1 idp=https://cached.com'])

    await resolveDDISA('cache.com')
    await resolveDDISA('cache.com') // cached
    expect(mockResolveTXT).toHaveBeenCalledTimes(1)

    await resolveDDISA('cache.com', { noCache: true }) // bypasses cache
    expect(mockResolveTXT).toHaveBeenCalledTimes(2)
  })

  it('selects record with lowest priority', async () => {
    mockResolveTXT.mockResolvedValueOnce([
      'v=ddisa1 idp=https://backup.com; priority=20',
      'v=ddisa1 idp=https://primary.com; priority=5',
    ])
    expect((await resolveDDISA('prio.com', { noCache: true }))?.idp).toBe('https://primary.com')
  })

  it('skips records that fail parsing', async () => {
    mockResolveTXT.mockResolvedValueOnce([
      'v=ddisa1', // no idp → null
      'v=ddisa1 idp=https://valid.com',
    ])
    expect((await resolveDDISA('bad.com', { noCache: true }))?.idp).toBe('https://valid.com')
  })

  it('falls back to DoH when native DNS throws', async () => {
    mockResolveTXT.mockRejectedValueOnce(new Error('not implemented'))
    // DoH will query a real DNS server — expect null for non-existent domain
    const record = await resolveDDISA('doh-fallback.com', { noCache: true })
    expect(record).toBeNull()
  })

  it('caches negative resolves so a non-DDISA domain does NOT re-query DNS each time (#306)', async () => {
    // Without negative caching, every authorize for a user from a
    // non-DDISA domain would re-hit the resolver — wasted latency
    // plus a DoS vector. We cache `null` results just like positive
    // ones, but with a shorter TTL.
    mockResolveTXT.mockResolvedValue([])

    expect(await resolveDDISA('no-record.com')).toBeNull()
    expect(await resolveDDISA('no-record.com')).toBeNull()
    expect(await resolveDDISA('no-record.com')).toBeNull()

    expect(mockResolveTXT).toHaveBeenCalledTimes(1)
  })

  it('respects negativeCacheTTL override on the negative path', async () => {
    mockResolveTXT.mockResolvedValue([])

    // 0 means "expired immediately" → next call re-queries
    expect(await resolveDDISA('zero-neg.com', { negativeCacheTTL: 0 })).toBeNull()
    // Tiny sleep so the expiry check (`expires > Date.now()`) sees the entry as stale
    await new Promise(r => setTimeout(r, 5))
    expect(await resolveDDISA('zero-neg.com')).toBeNull()

    expect(mockResolveTXT).toHaveBeenCalledTimes(2)
  })

  it('clearDNSCacheFor drops a single domain entry without touching others', async () => {
    mockResolveTXT.mockResolvedValue(['v=ddisa1 idp=https://idp.example.com'])

    // Warm two distinct entries.
    await resolveDDISA('foo.com')
    await resolveDDISA('bar.com')
    expect(mockResolveTXT).toHaveBeenCalledTimes(2)

    // Bust foo.com only — bar.com stays cached.
    expect(clearDNSCacheFor('foo.com')).toBe(true)
    await resolveDDISA('foo.com')
    await resolveDDISA('bar.com')
    expect(mockResolveTXT).toHaveBeenCalledTimes(3)
  })

  it('clearDNSCacheFor returns false when the entry was not cached', () => {
    expect(clearDNSCacheFor('never-resolved.com')).toBe(false)
  })
})
