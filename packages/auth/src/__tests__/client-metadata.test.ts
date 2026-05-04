import { describe, expect, it, vi } from 'vitest'
import { createClientMetadataResolver, validateRedirectUri } from '../idp/client-metadata'
import type { ClientMetadata } from '../idp/client-metadata'

const exampleMetadata: ClientMetadata = {
  client_id: 'app.example.com',
  client_name: 'Example App',
  redirect_uris: ['https://app.example.com/auth/callback'],
}

describe('createClientMetadataResolver — DDISA §4.1 SP metadata fetch', () => {
  it('resolves a hostname-y client_id by fetching /.well-known/oauth-client-metadata', async () => {
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      if (url === 'https://app.example.com/.well-known/oauth-client-metadata') {
        return exampleMetadata
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    const resolver = createClientMetadataResolver({ fetchImpl })
    const result = await resolver.resolve('app.example.com')
    expect(result).toEqual(exampleMetadata)
    expect(fetchImpl).toHaveBeenCalledWith('https://app.example.com/.well-known/oauth-client-metadata')
  })

  it('falls back to the legacy /.well-known/sp-manifest.json path', async () => {
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/.well-known/oauth-client-metadata')) {
        throw Object.assign(new Error('Not Found'), { statusCode: 404 })
      }
      if (url.endsWith('/.well-known/sp-manifest.json')) {
        return exampleMetadata
      }
      throw new Error(`unexpected ${url}`)
    })
    const resolver = createClientMetadataResolver({ fetchImpl })
    const result = await resolver.resolve('app.example.com')
    expect(result).toEqual(exampleMetadata)
  })

  it('returns null when both well-known paths fail', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => {
      throw new Error('network down')
    })
    const resolver = createClientMetadataResolver({ fetchImpl })
    expect(await resolver.resolve('app.example.com')).toBeNull()
  })

  it('returns null when the fetched document is malformed', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ client_id: 'no-redirects' })
    const resolver = createClientMetadataResolver({ fetchImpl })
    expect(await resolver.resolve('app.example.com')).toBeNull()
  })

  it('caches successful resolves until TTL expiry', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(exampleMetadata)
    const resolver = createClientMetadataResolver({ fetchImpl, cacheTtlMs: 60_000 })

    await resolver.resolve('app.example.com')
    await resolver.resolve('app.example.com')
    await resolver.resolve('app.example.com')

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('caches negative resolves too — protects the IdP from a hostile SP that 503s every fetch', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network'))
    const resolver = createClientMetadataResolver({ fetchImpl, cacheTtlMs: 60_000 })

    await resolver.resolve('app.example.com')
    await resolver.resolve('app.example.com')

    // Both well-known paths attempted ONCE, then cached.
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('uses the public-clients map for non-hostname client_ids (RFC 8252 native apps)', async () => {
    // Native CLIs have no domain so the well-known fetch makes no
    // sense; they live in a hardcoded allowlist on the IdP side.
    const fetchImpl = vi.fn()
    const resolver = createClientMetadataResolver({
      fetchImpl,
      publicClients: {
        'apes-cli': {
          client_id: 'apes-cli',
          redirect_uris: ['http://localhost:9876/callback'],
        },
      },
    })
    const result = await resolver.resolve('apes-cli')
    expect(result?.redirect_uris).toContain('http://localhost:9876/callback')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns null for an unregistered public-client', async () => {
    const resolver = createClientMetadataResolver({ publicClients: {} })
    expect(await resolver.resolve('rogue-cli')).toBeNull()
  })
})

describe('validateRedirectUri', () => {
  function staticStore(metadata: ClientMetadata | null) {
    return { resolve: async () => metadata }
  }

  it('passes when redirect_uri exactly matches a registered URI', async () => {
    const result = await validateRedirectUri(
      'app.example.com',
      'https://app.example.com/auth/callback',
      staticStore(exampleMetadata),
      'strict',
    )
    expect(result).toBeNull()
  })

  it('rejects when redirect_uri is a path-prefix of a registered URI', async () => {
    // Strict equality only — no path-prefix matching, no wildcard.
    const result = await validateRedirectUri(
      'app.example.com',
      'https://app.example.com/auth',
      staticStore(exampleMetadata),
      'strict',
    )
    expect(result).toMatchObject({ error: 'invalid_request' })
  })

  it('rejects when redirect_uri has extra query string vs. registered URI', async () => {
    const result = await validateRedirectUri(
      'app.example.com',
      'https://app.example.com/auth/callback?next=admin',
      staticStore(exampleMetadata),
      'strict',
    )
    expect(result).toMatchObject({ error: 'invalid_request' })
  })

  it('strict mode rejects unresolvable client_id', async () => {
    const result = await validateRedirectUri(
      'unknown.example.com',
      'https://anywhere/cb',
      staticStore(null),
      'strict',
    )
    expect(result).toMatchObject({ error: 'invalid_client' })
  })

  it('permissive mode allows unresolvable client_id (warn-only rollout)', async () => {
    const result = await validateRedirectUri(
      'unknown.example.com',
      'https://anywhere/cb',
      staticStore(null),
      'permissive',
    )
    expect(result).toBeNull()
  })

  it('permissive mode still rejects when metadata is resolvable but mismatched', async () => {
    // The point of permissive mode is to tolerate SPs that haven't yet
    // published metadata — NOT to ignore explicit mismatches once they
    // have. A mismatch is always a hard error.
    const result = await validateRedirectUri(
      'app.example.com',
      'https://attacker.example.com/cb',
      staticStore(exampleMetadata),
      'permissive',
    )
    expect(result).toMatchObject({ error: 'invalid_request' })
  })
})
