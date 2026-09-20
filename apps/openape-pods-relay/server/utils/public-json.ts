import { lookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import { isBlockedAddress } from '@openape/core'
import { ProtocolError } from '@openape/pods-protocol'

export async function publicJson(url: URL, body?: unknown, fixture = false): Promise<unknown> {
  const localFixture = fixture && url.protocol === 'http:' && url.hostname === '127.0.0.1'
  if ((!localFixture && url.protocol !== 'https:') || url.username || url.password || url.hash) throw new ProtocolError('unsafe_identity_provider', 502)
  const addresses = await lookup(url.hostname, { all: true })
  if (!addresses.length || (!localFixture && addresses.some(item => isBlockedAddress(item.address)))) throw new ProtocolError('unsafe_identity_provider', 502)
  const address = addresses[0]!
  const data = body === undefined ? undefined : JSON.stringify(body)
  return await new Promise((resolve, reject) => {
    const request = (localFixture ? httpRequest : httpsRequest)(url, {
      method: data ? 'POST' : 'GET',
      headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {},
      lookup: (_host, options, callback) => { if (options.all) callback(null, [address]); else callback(null, address.address, address.family) },
    }, (response) => {
      if (response.statusCode !== 200) { response.resume(); reject(new ProtocolError('identity_provider_unavailable', 502)); return }
      const chunks: Buffer[] = []; let length = 0
      response.on('data', (chunk: Buffer) => {
        length += chunk.length
        if (length > 65536) { request.destroy(new ProtocolError('identity_response_too_large', 502)); return }
        chunks.push(chunk)
      })
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
        catch { reject(new ProtocolError('invalid_identity_response', 502)) }
      })
      response.on('error', reject)
    })
    request.setTimeout(10000, () => request.destroy(new ProtocolError('identity_provider_timeout', 502)))
    request.on('error', reject)
    if (data) request.write(data)
    request.end()
  })
}
