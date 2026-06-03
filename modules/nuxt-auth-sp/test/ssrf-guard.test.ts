import { describe, expect, it } from 'vitest'
import { assertSafeIdpUrl, isBlockedAddress } from '../src/runtime/server/utils/ssrf-guard'

describe('isBlockedAddress', () => {
  it('blocks loopback / private / link-local / cgnat IPv4', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0']) {
      expect(isBlockedAddress(ip), ip).toBe(true)
    }
  })

  it('allows public IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '93.184.216.34']) {
      expect(isBlockedAddress(ip), ip).toBe(false)
    }
  })

  it('blocks loopback / link-local / ULA IPv6 and mapped IPv4', () => {
    for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:10.0.0.1', '::ffff:127.0.0.1']) {
      expect(isBlockedAddress(ip), ip).toBe(true)
    }
  })

  it('allows public IPv6', () => {
    expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false)
  })
})

describe('assertSafeIdpUrl', () => {
  it('rejects non-https schemes', async () => {
    await expect(assertSafeIdpUrl('http://example.com')).rejects.toThrow(/https/)
  })

  it('rejects literal private/loopback hosts', async () => {
    await expect(assertSafeIdpUrl('https://127.0.0.1')).rejects.toThrow(/blocked/)
    await expect(assertSafeIdpUrl('https://169.254.169.254/latest/meta-data')).rejects.toThrow(/blocked/)
    await expect(assertSafeIdpUrl('https://[::1]')).rejects.toThrow(/blocked/)
  })

  it('rejects hostnames that resolve to loopback (localhost)', async () => {
    await expect(assertSafeIdpUrl('https://localhost')).rejects.toThrow(/blocked/)
  })

  it('rejects malformed URLs', async () => {
    await expect(assertSafeIdpUrl('not a url')).rejects.toThrow(/Invalid/)
  })

  it('allows a public literal IP', async () => {
    await expect(assertSafeIdpUrl('https://8.8.8.8')).resolves.toBeUndefined()
  })
})
