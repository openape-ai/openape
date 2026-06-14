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

describe('core constants', () => {
  it('exports the spec-bound assertion TTL and JWT algorithm', () => {
    expect(MAX_ASSERTION_TTL).toBe(300)
    expect(ALGORITHM).toBe('EdDSA')
  })

  it('exports the expected well-known paths', () => {
    expect(WELL_KNOWN_JWKS).toBe('/.well-known/jwks.json')
    expect(WELL_KNOWN_OAUTH_CLIENT_METADATA).toBe('/.well-known/oauth-client-metadata')
    expect(WELL_KNOWN_OPENID_CONFIG).toBe('/.well-known/openid-configuration')
  })

  it('exports positive and negative DNS cache TTLs with the negative TTL shorter than the positive TTL', () => {
    expect(DEFAULT_DNS_CACHE_TTL).toBe(300)
    expect(DEFAULT_DNS_NEGATIVE_CACHE_TTL).toBe(60)
    expect(DEFAULT_DNS_NEGATIVE_CACHE_TTL).toBeLessThan(DEFAULT_DNS_CACHE_TTL)
  })

  it('exports the TXT record type number', () => {
    expect(DNS_TXT_TYPE).toBe(16)
  })

  it('exports only https DoH providers without duplicates', () => {
    expect(DOH_PROVIDERS.length).toBeGreaterThan(0)
    expect(new Set(DOH_PROVIDERS).size).toBe(DOH_PROVIDERS.length)

    for (const provider of DOH_PROVIDERS) {
      const url = new URL(provider)
      expect(url.protocol).toBe('https:')
      expect(url.pathname.length).toBeGreaterThan(0)
    }
  })
})
