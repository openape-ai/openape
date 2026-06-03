import { describe, expect, it, vi } from 'vitest'

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async (host: string, _opts: unknown) => {
    // localhost → loopback; everything else treated as public 1.2.3.4
    if (host === 'localhost') return [{ address: '127.0.0.1', family: 4 }]
    if (host === 'private.internal') return [{ address: '10.0.0.1', family: 4 }]
    if (host === 'nxdomain.example') return []
    return [{ address: '1.2.3.4', family: 4 }]
  }),
}))

const { isBlockedAddress, assertPublicUrl } = await import('../net/ssrf-guard.js')

describe('isBlockedAddress', () => {
  describe('IPv4 — blocked', () => {
    it('blocks loopback 127.x.x.x', () => {
      expect(isBlockedAddress('127.0.0.1')).toBe(true)
      expect(isBlockedAddress('127.255.255.255')).toBe(true)
    })
    it('blocks 0.0.0.0/8 "this network"', () => {
      expect(isBlockedAddress('0.0.0.0')).toBe(true)
    })
    it('blocks RFC1918 10/8', () => {
      expect(isBlockedAddress('10.0.0.1')).toBe(true)
      expect(isBlockedAddress('10.255.255.255')).toBe(true)
    })
    it('blocks RFC1918 172.16/12', () => {
      expect(isBlockedAddress('172.16.0.1')).toBe(true)
      expect(isBlockedAddress('172.31.255.255')).toBe(true)
    })
    it('blocks RFC1918 192.168/16', () => {
      expect(isBlockedAddress('192.168.0.1')).toBe(true)
      expect(isBlockedAddress('192.168.255.255')).toBe(true)
    })
    it('blocks link-local 169.254/16 (cloud metadata)', () => {
      expect(isBlockedAddress('169.254.169.254')).toBe(true)
      expect(isBlockedAddress('169.254.0.1')).toBe(true)
    })
    it('blocks CGNAT 100.64/10', () => {
      expect(isBlockedAddress('100.64.0.1')).toBe(true)
      expect(isBlockedAddress('100.127.255.255')).toBe(true)
    })
  })

  describe('IPv4 — allowed', () => {
    it('allows public IPs', () => {
      for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '93.184.216.34']) {
        expect(isBlockedAddress(ip), ip).toBe(false)
      }
    })
  })

  describe('IPv6 — blocked', () => {
    it('blocks :: (unspecified) and ::1 (loopback)', () => {
      expect(isBlockedAddress('::')).toBe(true)
      expect(isBlockedAddress('::1')).toBe(true)
    })
    it('blocks fe80::/10 link-local', () => {
      expect(isBlockedAddress('fe80::1')).toBe(true)
    })
    it('blocks fc00::/7 ULA (fc and fd)', () => {
      expect(isBlockedAddress('fc00::1')).toBe(true)
      expect(isBlockedAddress('fd12::1')).toBe(true)
    })
    it('blocks IPv4-mapped addresses that are private', () => {
      expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true)
      expect(isBlockedAddress('::ffff:10.0.0.1')).toBe(true)
      expect(isBlockedAddress('::ffff:169.254.169.254')).toBe(true)
    })
  })

  describe('IPv6 — allowed', () => {
    it('allows public IPv6', () => {
      expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false)
    })
    it('allows IPv4-mapped public address', () => {
      expect(isBlockedAddress('::ffff:8.8.8.8')).toBe(false)
    })
  })
})

describe('assertPublicUrl', () => {
  describe('https-only (default)', () => {
    it('rejects http:// URLs', async () => {
      await expect(assertPublicUrl('http://example.com')).rejects.toThrow(/https/)
    })
    it('accepts https:// URLs', async () => {
      await expect(assertPublicUrl('https://example.com')).resolves.toBeInstanceOf(URL)
    })
    it('rejects non-http(s) schemes', async () => {
      await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow(/https/)
    })
  })

  describe('allowHttp: true', () => {
    it('accepts http:// URLs', async () => {
      await expect(assertPublicUrl('http://example.com', { allowHttp: true })).resolves.toBeInstanceOf(URL)
    })
    it('accepts https:// URLs', async () => {
      await expect(assertPublicUrl('https://example.com', { allowHttp: true })).resolves.toBeInstanceOf(URL)
    })
    it('rejects non-http(s) schemes', async () => {
      await expect(assertPublicUrl('file:///etc/passwd', { allowHttp: true })).rejects.toThrow(/http/)
    })
  })

  describe('malformed URLs', () => {
    it('rejects malformed URLs', async () => {
      await expect(assertPublicUrl('not a url')).rejects.toThrow(/Invalid URL/)
    })
  })

  describe('literal private/loopback/metadata hosts', () => {
    it('rejects loopback IP 127.0.0.1', async () => {
      await expect(assertPublicUrl('https://127.0.0.1')).rejects.toThrow(/private\/loopback/)
    })
    it('rejects cloud metadata endpoint 169.254.169.254', async () => {
      await expect(assertPublicUrl('https://169.254.169.254/latest/meta-data')).rejects.toThrow(/private\/loopback/)
    })
    it('rejects literal IPv6 loopback [::1]', async () => {
      await expect(assertPublicUrl('https://[::1]')).rejects.toThrow(/private\/loopback/)
    })
    it('rejects RFC1918 address via http (allowHttp: true)', async () => {
      await expect(assertPublicUrl('http://10.0.0.5:6379', { allowHttp: true })).rejects.toThrow(/private\/loopback/)
    })
  })

  describe('hostname DNS resolution', () => {
    it('rejects localhost (resolves to loopback)', async () => {
      await expect(assertPublicUrl('https://localhost')).rejects.toThrow(/private\/loopback/)
    })
    it('rejects hostname resolving to private IP', async () => {
      await expect(assertPublicUrl('https://private.internal')).rejects.toThrow(/private\/loopback/)
    })
    it('rejects hostname that resolves to no addresses', async () => {
      await expect(assertPublicUrl('https://nxdomain.example')).rejects.toThrow(/did not resolve/)
    })
  })

  describe('public literal IP', () => {
    it('allows a public literal IPv4', async () => {
      const result = await assertPublicUrl('https://8.8.8.8')
      expect(result).toBeInstanceOf(URL)
      expect(result.hostname).toBe('8.8.8.8')
    })
  })
})
