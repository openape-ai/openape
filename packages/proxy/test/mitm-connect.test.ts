import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, connect as netConnect } from 'node:net'
import { connect as tlsConnect, createServer as createTlsServer } from 'node:tls'
import { loadOrCreateCa, createLeafCertCache } from '../src/ca-store.js'
import { handleMitmConnect } from '../src/mitm-connect.js'

describe('handleMitmConnect — terminate TLS and read request', () => {
  it('reads the inner HTTP request after TLS handshake', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitm-'))
    const ca = loadOrCreateCa({
      certPath: join(dir, 'ca.crt'),
      keyPath: join(dir, 'ca.key'),
      subjectCN: 'OpenApe MITM Test CA',
    })
    const leafCache = createLeafCertCache(ca, { capacity: 32 })

    let observedRequestLine: string | null = null
    let observedHeaderName: string | null = null

    const inject = (req: { method: string, host: string, path: string, headers: Map<string, string> }) => {
      observedRequestLine = `${req.method} ${req.path}`
      for (const k of req.headers.keys()) observedHeaderName ??= k
      return { type: 'short-circuit' as const, status: 200, body: 'ok' }
    }

    const server = createServer((socket) => {
      handleMitmConnect({
        clientSocket: socket,
        host: 'example.com',
        port: 443,
        leafCache,
        onRequest: inject,
      })
    })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
    const addr = server.address() as { port: number }

    const tlsSock = tlsConnect({
      host: '127.0.0.1',
      port: addr.port,
      ca: ca.certPem,
      servername: 'example.com',
    })
    await new Promise<void>((resolve, reject) => {
      tlsSock.once('secureConnect', () => resolve())
      tlsSock.once('error', reject)
    })
    tlsSock.write('GET /healthz HTTP/1.1\r\nHost: example.com\r\nX-Test: 1\r\n\r\n')

    await new Promise<void>(resolve => tlsSock.once('data', () => resolve()))
    expect(observedRequestLine).toBe('GET /healthz')
    expect(observedHeaderName).toBeTruthy()
    server.close()
    tlsSock.destroy()
  })
})

describe('handleMitmConnect — forward to upstream', () => {
  it('opens upstream TLS, sends mutated request, returns response to client', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitm-fwd-'))
    const ca = loadOrCreateCa({
      certPath: join(dir, 'ca.crt'),
      keyPath: join(dir, 'ca.key'),
      subjectCN: 'CA',
    })
    const leafCache = createLeafCertCache(ca, { capacity: 32 })

    // Upstream that echoes back the request bytes as the response body so the test can inspect them.
    // The upstream uses a re-used leaf cert as a self-signed cert; the MITM connects with rejectUnauthorized=false.
    const upstreamLeaf = leafCache.get('upstream.local')
    const upstream = createTlsServer({
      cert: upstreamLeaf.certPem,
      key: upstreamLeaf.keyPem,
    }, (sock) => {
      sock.on('data', (chunk) => {
        sock.write(`HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: ${chunk.length}\r\n\r\n`)
        sock.write(chunk)
        sock.end()
      })
    })
    await new Promise<void>(r => upstream.listen(0, '127.0.0.1', () => r()))
    const upstreamPort = (upstream.address() as { port: number }).port

    // Proxy server: writes 200 Established, then hands the socket to handleMitmConnect.
    // We use 'localhost' instead of an IP because Node's TLS does not allow IP literals as
    // SNI server names; 'localhost' resolves to 127.0.0.1 for the upstream dial.
    const proxy = createServer((socket) => {
      // Simulate the CONNECT-receiving role: read the CONNECT line (don't validate — just consume), reply with 200.
      socket.once('data', () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        handleMitmConnect({
          clientSocket: socket,
          host: 'localhost',
          port: upstreamPort,
          leafCache,
          onRequest: () => ({
            type: 'forward',
            mutatedHeaders: new Map([['authorization', 'Bearer INJECTED']]),
          }),
          upstreamRejectUnauthorized: false,
        })
      })
    })
    await new Promise<void>(r => proxy.listen(0, '127.0.0.1', () => r()))
    const proxyPort = (proxy.address() as { port: number }).port

    // Client: connect raw, send CONNECT, wait for 200, then start TLS.
    const echo = await new Promise<string>((resolveBody, rejectBody) => {
      const raw = netConnect(proxyPort, '127.0.0.1', () => {
        raw.write(`CONNECT localhost:${upstreamPort} HTTP/1.1\r\nHost: localhost\r\n\r\n`)
      })
      raw.once('data', () => {
        const tls = tlsConnect({ socket: raw, ca: ca.certPem, servername: 'localhost' })
        tls.once('secureConnect', () => {
          tls.write(`POST /test HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ORIGINAL\r\nContent-Length: 0\r\n\r\n`)
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
