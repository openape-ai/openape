import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { connect as tlsConnect } from 'node:tls'
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
