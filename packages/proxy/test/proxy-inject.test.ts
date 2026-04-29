import { describe, expect, it, vi } from 'vitest'
import { createMultiAgentProxy } from '../src/proxy.js'
import { parseSecretsBlob } from '../src/secrets-store.js'
import type { MultiAgentProxyConfig } from '../src/types.js'

// Bypass SSRF/DNS for the synthetic `echo.local` / `other.com` hosts these
// tests use — they are placeholders for the inject hook, not real upstreams.
vi.mock('../src/ssrf.js', () => ({
  checkEgress: async () => ({ kind: 'ok' as const }),
}))

describe('proxy fetch — inject hook', () => {
  it('sets the configured header when a secret matches the target', async () => {
    const config: MultiAgentProxyConfig = {
      proxy: { listen: '127.0.0.1:0', default_action: 'allow', mandatory_auth: false },
      agents: [{ email: 'a@example.com', idp_url: 'https://id.example.com', allow: [{ domain: '*' }] }],
    }

    const store = parseSecretsBlob(`
version = "1"
[secrets.gh]
target   = "echo.local/*"
header   = "Authorization"
template = "Bearer \${value}"
value    = "ghp_X"
`)

    // Stub global fetch the proxy uses for upstream calls.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'))

    const proxy = createMultiAgentProxy(config, undefined, { secretsStore: store })
    const req = new Request('http://localhost/http://echo.local/data', {
      method: 'GET',
    })
    await proxy.fetch(req)

    const upstreamReq = fetchSpy.mock.calls[0]?.[0] as Request
    expect(upstreamReq.headers.get('Authorization')).toBe('Bearer ghp_X')
    fetchSpy.mockRestore()
  })

  it('does not modify headers when no secret matches', async () => {
    const config: MultiAgentProxyConfig = {
      proxy: { listen: '127.0.0.1:0', default_action: 'allow', mandatory_auth: false },
      agents: [{ email: 'a@example.com', idp_url: 'https://id.example.com', allow: [{ domain: '*' }] }],
    }

    const store = parseSecretsBlob(`
version = "1"
[secrets.gh]
target   = "echo.local/*"
header   = "Authorization"
template = "Bearer \${value}"
value    = "ghp_X"
`)

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'))
    const proxy = createMultiAgentProxy(config, undefined, { secretsStore: store })
    await proxy.fetch(new Request('http://localhost/http://other.com/x'))
    const upstreamReq = fetchSpy.mock.calls[0]?.[0] as Request
    expect(upstreamReq.headers.get('Authorization')).toBeNull()
    fetchSpy.mockRestore()
  })
})
