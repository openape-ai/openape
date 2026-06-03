import { describe, expect, it } from 'vitest'
import { assertPublicUrl, isBlockedAddress } from '../src/agent-tools/ssrf-guard'

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

  it('blocks loopback / link-local / ULA IPv6 + mapped IPv4', () => {
    for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:169.254.169.254']) {
      expect(isBlockedAddress(ip), ip).toBe(true)
    }
  })
})

describe('assertPublicUrl', () => {
  it('rejects non-http(s) schemes', async () => {
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow(/http/)
    await expect(assertPublicUrl('not a url')).rejects.toThrow(/Invalid URL/)
  })

  it('rejects literal private/loopback/metadata hosts', async () => {
    await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow(/private\/loopback/)
    await expect(assertPublicUrl('https://127.0.0.1')).rejects.toThrow(/private\/loopback/)
    await expect(assertPublicUrl('http://10.0.0.5:6379')).rejects.toThrow(/private\/loopback/)
    await expect(assertPublicUrl('https://[::1]')).rejects.toThrow(/private\/loopback/)
  })

  it('rejects hostnames resolving to loopback (localhost)', async () => {
    await expect(assertPublicUrl('http://localhost:3000')).rejects.toThrow(/private\/loopback/)
  })

  it('allows a public literal IP', async () => {
    await expect(assertPublicUrl('https://8.8.8.8')).resolves.toBeInstanceOf(URL)
  })
})
