import { TLSSocket, createSecureContext, connect as tlsConnect } from 'node:tls'
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
  upstreamRejectUnauthorized?: boolean
}

export function handleMitmConnect(opts: MitmConnectOpts): void {
  const leaf = opts.leafCache.get(opts.host)
  const ctx = createSecureContext({ cert: leaf.certPem, key: leaf.keyPem })
  // The CONNECT 200 response is the caller's responsibility (see `connect.ts`).
  // By the time we get here the client is already in TLS-handshake mode on the
  // socket, so we must not inject any plaintext bytes before TLS termination.
  const tls = new TLSSocket(opts.clientSocket, { isServer: true, secureContext: ctx })

  let buffer = Buffer.alloc(0)
  let dispatched = false
  tls.on('data', (chunk) => {
    if (dispatched) return // forward path pipes upstream→tls; ignore further client data here
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
      // inject decisions use only target+headers; raw body bytes still flow through to upstream below
      body: null,
    })

    if (decision.type === 'short-circuit') {
      dispatched = true
      const body = Buffer.from(decision.body, 'utf-8')
      tls.write(`HTTP/1.1 ${decision.status} OK\r\nContent-Length: ${body.length}\r\n\r\n`)
      tls.write(body)
      tls.end()
      return
    }

    // forward path: open upstream TLS, write the mutated request + any body bytes already buffered,
    // then pipe upstream → client. Subsequent client bytes (request bodies for streaming uploads,
    // pipelined requests) are forwarded raw via tls.pipe(upstream).
    dispatched = true
    const upstream = tlsConnect({
      host: opts.host,
      port: opts.port,
      servername: opts.host,
      rejectUnauthorized: opts.upstreamRejectUnauthorized ?? true,
    })
    upstream.once('secureConnect', () => {
      // Re-serialize the request: keep all original header lines except the ones being mutated;
      // append mutated headers at the end with canonical capitalization.
      const mutated = decision.mutatedHeaders
      const newHeaderLines: string[] = []
      for (const line of lines.slice(1)) {
        const i = line.indexOf(':')
        if (i <= 0) continue
        const lower = line.slice(0, i).trim().toLowerCase()
        if (mutated.has(lower)) continue // we'll write the mutated version below
        newHeaderLines.push(line)
      }
      for (const [name, value] of mutated.entries()) {
        newHeaderLines.push(`${capitalizeHeader(name)}: ${value}`)
      }
      const fullRequest = [requestLine, ...newHeaderLines, '', ''].join('\r\n')
      upstream.write(fullRequest)
      // body bytes that arrived in the same chunk as the header block:
      const remainder = buffer.subarray(headerEnd + 4)
      if (remainder.length > 0) upstream.write(remainder)
      upstream.pipe(tls)
      // any further client-side bytes (streaming uploads / pipelined requests) flow upstream raw
      tls.pipe(upstream)
    })
    upstream.on('error', () => tls.end())
  })
  tls.on('error', () => opts.clientSocket.destroy())
}

function capitalizeHeader(name: string): string {
  return name
    .split('-')
    .map(p => (p[0]?.toUpperCase() ?? '') + p.slice(1))
    .join('-')
}
