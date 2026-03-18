import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearDiscoveryCache, discoverEndpoints, extractDomain, getAgentAuthenticateEndpoint, getAgentChallengeEndpoint, getGrantsEndpoint, getJwksUri } from '../../src/idp/discovery.js'

describe('extractDomain', () => {
  it('extracts domain from email', () => {
    expect(extractDomain('agent@openape.at')).toBe('openape.at')
  })

  it('throws for invalid email', () => {
    expect(() => extractDomain('invalid')).toThrow('Invalid email')
  })

  it('throws for empty string', () => {
    expect(() => extractDomain('')).toThrow('Invalid email')
  })
})

describe('discoverEndpoints', () => {
  afterEach(() => {
    clearDiscoveryCache()
    vi.restoreAllMocks()
  })

  it('caches discovery results', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        issuer: 'https://id.openape.at',
        openape_grants_endpoint: 'https://id.openape.at/api/grants',
        jwks_uri: 'https://id.openape.at/.well-known/jwks.json',
      }), { status: 200 }),
    )

    const result1 = await discoverEndpoints('https://id.openape.at')
    const result2 = await discoverEndpoints('https://id.openape.at')

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(result1).toEqual(result2)
    expect(result1.issuer).toBe('https://id.openape.at')
  })

  it('returns empty object on fetch failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network error'))

    const result = await discoverEndpoints('https://nonexistent.example.com')
    expect(result).toEqual({})
  })

  it('returns empty object on non-200 response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }))

    const result = await discoverEndpoints('https://example.com')
    expect(result).toEqual({})
  })
})

describe('endpoint discovery helpers', () => {
  afterEach(() => {
    clearDiscoveryCache()
    vi.restoreAllMocks()
  })

  it('resolves grants endpoint from discovery', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        openape_grants_endpoint: 'https://id.openape.at/api/v2/grants',
      }), { status: 200 }),
    )

    const url = await getGrantsEndpoint('https://id.openape.at')
    expect(url).toBe('https://id.openape.at/api/v2/grants')
  })

  it('falls back for grants endpoint', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))

    const url = await getGrantsEndpoint('https://id.openape.at')
    expect(url).toBe('https://id.openape.at/api/grants')
  })

  it('resolves challenge endpoint from discovery', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        ddisa_agent_challenge_endpoint: 'https://id.openape.at/api/agent/v2/challenge',
      }), { status: 200 }),
    )

    const url = await getAgentChallengeEndpoint('https://id.openape.at')
    expect(url).toBe('https://id.openape.at/api/agent/v2/challenge')
  })

  it('falls back for challenge endpoint', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))

    const url = await getAgentChallengeEndpoint('https://id.openape.at')
    expect(url).toBe('https://id.openape.at/api/agent/challenge')
  })

  it('resolves authenticate endpoint', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))

    const url = await getAgentAuthenticateEndpoint('https://id.openape.at')
    expect(url).toBe('https://id.openape.at/api/agent/authenticate')
  })

  it('resolves JWKS URI', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ jwks_uri: 'https://id.openape.at/keys' }), { status: 200 }),
    )

    const url = await getJwksUri('https://id.openape.at')
    expect(url).toBe('https://id.openape.at/keys')
  })

  it('falls back for JWKS URI', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))

    const url = await getJwksUri('https://id.openape.at')
    expect(url).toBe('https://id.openape.at/.well-known/jwks.json')
  })
})
