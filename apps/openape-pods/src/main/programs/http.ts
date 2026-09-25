import { request as httpsRequest } from 'node:https'
import { lookup } from 'node:dns/promises'
import { BlockList } from 'node:net'
import { httpResponseBodyBytes, parseHttpReply } from '../../contracts/http'
import type { HttpRequest, HttpReply } from '../../contracts/http'

type Transport = (url: string, options: RequestInit) => Promise<Response>
const privateAddresses = new BlockList()
for (const [network, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['192.0.0.0', 24], ['192.0.2.0', 24], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) privateAddresses.addSubnet(network, prefix, 'ipv4')

export async function publicHttpsAddresses(host: string) {
  const addresses = await lookup(host, { family: 4, all: true })
  if (!addresses.length || addresses.some(item => privateAddresses.check(item.address, 'ipv4'))) throw new Error('HTTP destination is not a public address')
  return addresses
}

export async function publicHttps(urlString: string, options: RequestInit): Promise<Response> {
  const url = new URL(urlString)
  const addresses = await publicHttpsAddresses(url.hostname)
  options.signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, { method: options.method, headers: options.headers as Record<string, string>, signal: options.signal ?? undefined, family: 4, lookup: (_host, _options, callback) => callback(null, addresses[0].address, 4) }, (response) => {
      const chunks: Buffer[] = []; let size = 0
      response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > httpResponseBodyBytes) response.destroy(new Error('HTTP response exceeds its size limit')); else chunks.push(chunk) })
      response.once('error', reject)
      response.once('end', () => {
        const status = response.statusCode ?? 502
        if (status >= 300 && status < 400) { reject(new Error('HTTP redirects are not allowed')); return }
        const headers = new Headers()
        for (const [key, value] of Object.entries(response.headers)) {
          if (typeof value === 'string' && key !== 'set-cookie') headers.set(key, value)
        }
        resolve(new Response([204, 205, 304].includes(status) || options.method === 'HEAD' ? null : Buffer.concat(chunks), { status, headers }))
      })
    })
    request.once('error', reject)
    request.end(options.body)
  })
}

export async function requestHttp(request: HttpRequest, signal: AbortSignal, transport: Transport = publicHttps): Promise<HttpReply> {
  signal.throwIfAborted()
  try {
    const response = await transport(request.url, { method: request.method, headers: request.headers, body: request.body, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) })
    if (response.status >= 300 && response.status < 400) throw new Error('HTTP redirects are not allowed')
    const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0
    if (reader) {
      try {
        for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > httpResponseBodyBytes) throw new Error('HTTP response exceeds its size limit'); chunks.push(chunk.value) }
      }
      finally { await reader.cancel(); reader.releaseLock() }
    }
    const headers: Record<string, string> = {}; response.headers.forEach((value, key) => { headers[key] = value })
    const reply = { status: response.status, headers, body: Buffer.concat(chunks).toString('utf8') }
    return parseHttpReply(reply)
  }
  catch { throw new Error('HTTP request failed; delivery may be uncertain') }
}
