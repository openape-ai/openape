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

describe('createClientMetadataResolver — sanitization of SP-supplied fields', () => {
  // SP metadata is fetched from an SP-controlled domain and rendered
  // by the IdP's consent UI. Without sanitization a malicious SP can
  // ship `javascript:` URIs in `policy_uri` / `tos_uri` and turn the
  // IdP origin into an XSS sandbox at click time. We strip anything
  // that's not http(s) at resolver time so downstream consumers can
  // bind these fields to `:href` / `:src` without re-validating.

  function resolverWithRaw(raw: unknown) {
    const fetchImpl = vi.fn().mockResolvedValue(raw)
    return createClientMetadataResolver({ fetchImpl })
  }

  it('drops javascript: URLs from policy_uri / tos_uri / client_uri / logo_uri', async () => {
    const resolver = resolverWithRaw({
      client_id: 'evil.example.com',
      client_name: 'Microsoft Login',
      redirect_uris: ['https://evil.example.com/cb'],
      policy_uri: 'javascript:alert(document.cookie)',
      tos_uri: 'javascript:fetch("https://evil/x")',
      client_uri: 'javascript:void(0)',
      logo_uri: 'javascript:alert(1)',
    })
    const result = await resolver.resolve('evil.example.com')
    expect(result?.policy_uri).toBeUndefined()
    expect(result?.tos_uri).toBeUndefined()
    expect(result?.client_uri).toBeUndefined()
    expect(result?.logo_uri).toBeUndefined()
    // Required fields preserved
    expect(result?.client_id).toBe('evil.example.com')
    expect(result?.redirect_uris).toEqual(['https://evil.example.com/cb'])
  })

  it('drops data: and vbscript: URLs from logo_uri', async () => {
    const resolver = resolverWithRaw({
      client_id: 'evil.example.com',
      redirect_uris: ['https://evil.example.com/cb'],
      logo_uri: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxzY3JpcHQ+YWxlcnQoMSk8L3NjcmlwdD48L3N2Zz4=',
    })
    const result = await resolver.resolve('evil.example.com')
    expect(result?.logo_uri).toBeUndefined()
  })

  it('keeps valid https URLs untouched', async () => {
    const resolver = resolverWithRaw({
      client_id: 'app.example.com',
      redirect_uris: ['https://app.example.com/cb'],
      policy_uri: 'https://app.example.com/privacy',
      tos_uri: 'https://app.example.com/terms',
      client_uri: 'https://app.example.com/',
      logo_uri: 'https://cdn.example.com/logo.png',
    })
    const result = await resolver.resolve('app.example.com')
    expect(result?.policy_uri).toBe('https://app.example.com/privacy')
    expect(result?.tos_uri).toBe('https://app.example.com/terms')
    expect(result?.client_uri).toBe('https://app.example.com/')
    expect(result?.logo_uri).toBe('https://cdn.example.com/logo.png')
  })

  it('truncates oversized client_name to prevent UI-disruption attacks', async () => {
    const resolver = resolverWithRaw({
      client_id: 'app.example.com',
      redirect_uris: ['https://app.example.com/cb'],
      client_name: 'X'.repeat(10_000),
    })
    const result = await resolver.resolve('app.example.com')
    expect(result?.client_name?.length).toBeLessThanOrEqual(200)
  })

  it('drops malformed URL strings entirely', async () => {
    const resolver = resolverWithRaw({
      client_id: 'app.example.com',
      redirect_uris: ['https://app.example.com/cb'],
      policy_uri: 'not-a-url',
      tos_uri: '',
    })
    const result = await resolver.resolve('app.example.com')
    expect(result?.policy_uri).toBeUndefined()
    expect(result?.tos_uri).toBeUndefined()
  })

  it('sanitizes publicClients entries the same way as fetched metadata', async () => {
    // Operator-supplied config is also untrusted-ish (typos, copy-paste
    // errors, supply-chain compromise of a config file) — apply the
    // same hygiene rule.
    const resolver = createClientMetadataResolver({
      publicClients: {
        'cli-tool': {
          client_id: 'cli-tool',
          redirect_uris: ['http://localhost:9876/cb'],
          policy_uri: 'javascript:alert(1)' as string,
        },
      },
    })
    const result = await resolver.resolve('cli-tool')
    expect(result?.policy_uri).toBeUndefined()
    expect(result?.redirect_uris).toEqual(['http://localhost:9876/cb'])
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
