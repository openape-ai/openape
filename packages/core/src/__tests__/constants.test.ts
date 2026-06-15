import { describe, expect, it } from 'vitest'
import {
  ALGORITHM,
  DEFAULT_DNS_CACHE_TTL,
  DEFAULT_DNS_NEGATIVE_CACHE_TTL,
  DNS_TXT_TYPE,
  DOH_PROVIDERS,
  MAX_ASSERTION_TTL,
  WELL_KNOWN_JWKS,
  WELL_KNOWN_OAUTH_CLIENT_METADATA,
  WELL_KNOWN_OPENID_CONFIG,
} from '../constants.js'

describe('constants', () => {
  it('pins protocol and cache boundary values', () => {
    expect(MAX_ASSERTION_TTL).toBe(300)
    expect(DEFAULT_DNS_CACHE_TTL).toBe(300)
    expect(DEFAULT_DNS_NEGATIVE_CACHE_TTL).toBe(60)
    expect(DEFAULT_DNS_NEGATIVE_CACHE_TTL).toBeLessThan(DEFAULT_DNS_CACHE_TTL)
    expect(ALGORITHM).toBe('EdDSA')
    expect(DNS_TXT_TYPE).toBe(16)
  })

  it('uses absolute well-known paths rooted at slash', () => {
    for (const path of [WELL_KNOWN_JWKS, WELL_KNOWN_OAUTH_CLIENT_METADATA, WELL_KNOWN_OPENID_CONFIG]) {
      expect(path.startsWith('/')).toBe(true)
      expect(path).toContain('/.well-known/')
      expect(path.endsWith('/')).toBe(false)
    }

    expect(WELL_KNOWN_JWKS).toBe('/.well-known/jwks.json')
    expect(WELL_KNOWN_OAUTH_CLIENT_METADATA).toBe('/.well-known/oauth-client-metadata')
    expect(WELL_KNOWN_OPENID_CONFIG).toBe('/.well-known/openid-configuration')
  })

  it('exposes exactly the expected DoH providers with https URLs and no duplicates', () => {
    expect(DOH_PROVIDERS).toEqual([
      'https://cloudflare-dns.com/dns-query',
      'https://dns.google/resolve',
      'https://dns.quad9.net:5053/dns-query',
    ])

    expect(new Set(DOH_PROVIDERS).size).toBe(DOH_PROVIDERS.length)
    for (const provider of DOH_PROVIDERS) {
      expect(provider.startsWith('https://')).toBe(true)
      expect(provider.includes('?')).toBe(false)
      expect(provider.endsWith('/')).toBe(false)
    }
  })
})
