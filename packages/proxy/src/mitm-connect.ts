import { TLSSocket, createSecureContext } from 'node:tls'
import type { Socket } from 'node:net'
import type { LeafCertCache } from './ca-store.js'

export interface MitmRequest {
  method: string
  host: string
  path: string
  headers: Map<string, string>
  body: Buffer | null
}

export type MitmDecision =
  | { type: 'short-circuit', status: number, body: string }
  | { type: 'forward', mutatedHeaders: Map<string, string> }

export interface MitmConnectOpts {
  clientSocket: Socket
  host: string
  port: number
  leafCache: LeafCertCache
  onRequest: (req: MitmRequest) => MitmDecision
}

export function handleMitmConnect(opts: MitmConnectOpts): void {
  const leaf = opts.leafCache.get(opts.host)
  const ctx = createSecureContext({ cert: leaf.certPem, key: leaf.keyPem })
  // The CONNECT 200 response is the caller's responsibility (see `connect.ts`).
  // By the time we get here the client is already in TLS-handshake mode on the
  // socket, so we must not inject any plaintext bytes before TLS termination.
  const tls = new TLSSocket(opts.clientSocket, { isServer: true, secureContext: ctx })

  let buffer = Buffer.alloc(0)
  tls.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    const headerEnd = buffer.indexOf('\r\n\r\n')
    if (headerEnd < 0) return // incomplete

    const headerBlock = buffer.subarray(0, headerEnd).toString('utf-8')
    const lines = headerBlock.split('\r\n')
    const requestLine = lines[0] ?? ''
    const [method, path] = requestLine.split(' ')
    const headers = new Map<string, string>()
    for (const line of lines.slice(1)) {
      const i = line.indexOf(':')
      if (i > 0) headers.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim())
    }

    const decision = opts.onRequest({
      method: method ?? '',
      host: opts.host,
      path: path ?? '/',
      headers,
      // inject decisions use only target+headers; raw body bytes still flow through to upstream in Task 10
      body: null,
    })

    if (decision.type === 'short-circuit') {
      const body = Buffer.from(decision.body, 'utf-8')
      tls.write(`HTTP/1.1 ${decision.status} OK\r\nContent-Length: ${body.length}\r\n\r\n`)
      tls.write(body)
      tls.end()
      return
    }
    // forward path implemented in Task 10
    tls.end()
  })
  tls.on('error', () => opts.clientSocket.destroy())
}
