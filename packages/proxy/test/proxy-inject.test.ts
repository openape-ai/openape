import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { createServer as createTlsServer, connect as tlsConnect } from 'node:tls'
import { connect as netConnect } from 'node:net'
import { createMultiAgentProxy } from '../src/proxy.js'
import { handleConnect } from '../src/connect.js'
import { loadOrCreateCa, createLeafCertCache } from '../src/ca-store.js'
import { GrantsClient } from '../src/grants-client.js'
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

describe('connect — MITM inject for HTTPS', () => {
  it('injects the configured header through the MITM tunnel', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'connect-inject-'))
    const ca = loadOrCreateCa({
      certPath: join(dir, 'ca.crt'),
      keyPath: join(dir, 'ca.key'),
      subjectCN: 'CA',
    })
    const leafCache = createLeafCertCache(ca, { capacity: 32 })

    // Fake upstream: echoes the request bytes back as the response body so the
    // test can inspect them. Reuses a leaf cert from the same CA — the proxy
    // dials with rejectUnauthorized=false so the self-signed chain is fine.
    const upstreamLeaf = leafCache.get('localhost')
    const upstream = createTlsServer({
      cert: upstreamLeaf.certPem,
      key: upstreamLeaf.keyPem,
    }, (sock) => {
      sock.on('data', (chunk) => {
        sock.write(`HTTP/1.1 200 OK\r\nContent-Length: ${chunk.length}\r\n\r\n`)
        sock.write(chunk)
        sock.end()
      })
    })
    await new Promise<void>(r => upstream.listen(0, '127.0.0.1', () => r()))
    const upstreamPort = (upstream.address() as { port: number }).port

    const store = parseSecretsBlob(`
version = "1"
[secrets.gh]
target   = "localhost:${upstreamPort}/*"
header   = "Authorization"
template = "Bearer \${value}"
value    = "INJECTED"
`)

    const config: MultiAgentProxyConfig = {
      proxy: { listen: '127.0.0.1:0', default_action: 'allow', mandatory_auth: false },
      agents: [{ email: 'a@example.com', idp_url: 'https://id.example.com', allow: [{ domain: '*' }] }],
    }
    const grantsClients = new Map([['a@example.com', new GrantsClient(config.agents[0]!.idp_url)]])

    // Proxy server: receives CONNECT, delegates to handleConnect with deps.
    const proxy = createServer()
    proxy.on('connect', (req, sock, head) => {
      handleConnect(config, grantsClients, req, sock, head, {
        secretsStore: store,
        leafCache,
        upstreamRejectUnauthorized: false,
      })
    })
    await new Promise<void>(r => proxy.listen(0, '127.0.0.1', () => r()))
    const proxyPort = (proxy.address() as { port: number }).port

    // Client: connect, send CONNECT, wait for 200, then start TLS, send
    // request, read response.
    const echo = await new Promise<string>((resolveBody, rejectBody) => {
      const raw = netConnect(proxyPort, '127.0.0.1', () => {
        raw.write(`CONNECT localhost:${upstreamPort} HTTP/1.1\r\nHost: localhost:${upstreamPort}\r\n\r\n`)
      })
      raw.once('data', () => {
        const tls = tlsConnect({ socket: raw, ca: ca.certPem, servername: 'localhost' })
        tls.once('secureConnect', () => {
          tls.write(`GET / HTTP/1.1\r\nHost: localhost:${upstreamPort}\r\nAuthorization: Bearer ORIGINAL\r\nContent-Length: 0\r\n\r\n`)
        })
        let buf = ''
        tls.on('data', (b) => { buf += b.toString('utf-8') })
        tls.on('end', () => resolveBody(buf))
        tls.on('error', rejectBody)
      })
      raw.on('error', rejectBody)
    })

    expect(echo).toMatch(/Authorization: Bearer INJECTED/)
    expect(echo).not.toMatch(/Authorization: Bearer ORIGINAL/)

    proxy.close()
    upstream.close()
  })
})
