import { isError } from 'h3'
import { BlockList } from 'node:net'
import { lookup } from 'node:dns/promises'
import { request } from 'node:https'
import type { IncomingMessage } from 'node:http'
import { createProblemError } from './problem'
import { isBlockedAddress, resolveIdP } from '@openape/core'
import { brokerDomain, brokerObject, brokerOrigin } from '@openape/grants'
import { createLocalJWKSet } from 'jose'
import type { JSONWebKeySet } from 'jose'

const publicIpv6 = new BlockList()
publicIpv6.addSubnet('2000::', 3, 'ipv6')

interface BrokerHttpOptions {
  method?: string
  headers?: Record<string, string>
  body?: string
  /** Return a 403 body that carries an owner's denial or revocation (`authorize`) instead of failing. */
  relayRefusal?: boolean
}
export async function brokerFetch(raw: string, init: BrokerHttpOptions = {}): Promise<unknown> {
  try { return await fetchPublicBroker(raw, init) }
  catch (error) {
    if (isError(error)) throw error
    throw createProblemError({ status: 503, title: 'Broker service unavailable', type: 'https://openape.org/errors/broker_unavailable', detail: 'Verify public DNS, HTTPS and the provider deployment before retrying.' })
  }
}

async function fetchPublicBroker(raw: string, init: BrokerHttpOptions): Promise<unknown> {
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Broker transport requires HTTPS')
  const addresses = await lookup(url.hostname, { all: true })
  if (!addresses.length || addresses.some(item => isBlockedAddress(item.address) || (item.family === 6 && !publicIpv6.check(item.address, 'ipv6')))) throw createProblemError({ status: 403, title: 'Broker transport refuses private addresses', type: 'https://openape.org/errors/broker_identity_mismatch' })
  const address = addresses[0]!
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const outgoing = request(url, {
      method: init.method ?? 'GET', headers: init.headers, agent: false,
      signal: AbortSignal.timeout(10000),
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [address])
        else callback(null, address.address, address.family)
      },
    }, resolve)
    outgoing.on('error', reject)
    outgoing.end(init.body)
  })
  try {
    const status = response.statusCode
    const retryAfter = status === 429 ? Number(response.headers['retry-after']) : Number.NaN
    const failed = () => createProblemError({ status: status && [400, 401, 403, 404, 409, 429].includes(status) ? status : 503, title: `Broker service returned HTTP ${status ?? 'unknown'}`, ...(status === 429 && Number.isInteger(retryAfter) && retryAfter > 0 ? { retryAfter } : {}) })
    if (status === 403 && init.relayRefusal) {
      const refusal = await readBrokerJson(response)
      if (isOwnerRefusal(refusal)) return refusal
      throw failed()
    }
    if (!status || status < 200 || status >= 300) throw failed()
    return await readBrokerJson(response)
  }
  finally { response.destroy() }
}

async function readBrokerJson(response: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of response) {
    const data = Buffer.from(chunk)
    size += data.length
    if (size > 256 * 1024) throw new Error('Broker service response is too large')
    chunks.push(data)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

/** A decision IdP's 403 that carries the owner's denial or revocation of a program call. */
function isOwnerRefusal(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const state = (value as Record<string, unknown>).state
  return state === 'denied' || state === 'revoked'
}

function readBrokerMetadata<T>(read: () => T): T {
  try { return read() }
  catch { throw createProblemError({ status: 503, title: 'The identity provider returned invalid broker metadata', type: 'https://openape.org/errors/broker_unavailable' }) }
}

export async function discoverBroker(issuerInput: string, domainInput: string): Promise<Record<string, unknown>> {
  const issuer = brokerOrigin(issuerInput)
  const domain = brokerDomain(domainInput)
  let authoritative: string | null
  try { authoritative = await resolveIdP(domain) }
  catch { throw createProblemError({ status: 503, title: 'DDISA identity discovery is unavailable', type: 'https://openape.org/errors/broker_unavailable' }) }
  if (authoritative !== issuer) throw createProblemError({ status: 403, title: 'The issuer is not authoritative for this identity domain', type: 'https://openape.org/errors/broker_identity_mismatch' })
  const response = await brokerFetch(`${issuer}/.well-known/openid-configuration`)
  const discovery = readBrokerMetadata(() => brokerObject(response))
  if (discovery.issuer !== issuer || discovery.openape_grant_brokering_version !== '1.0') throw createProblemError({ status: 503, title: 'The identity provider does not support grant brokering', type: 'https://openape.org/errors/broker_unavailable' })
  return discovery
}

export function brokerEndpoint(discovery: Record<string, unknown>, field: string): string {
  return readBrokerMetadata(() => {
    const issuer = brokerOrigin(discovery.issuer)
    const value = discovery[field]
    if (typeof value !== 'string') throw new Error(`Missing broker endpoint: ${field}`)
    const url = new URL(value)
    if (url.origin !== issuer || url.username || url.password || url.search || url.hash) throw new Error('Broker endpoints must use their issuer origin')
    return url.href
  })
}

export async function brokerVerificationKey(discovery: Record<string, unknown>) {
  const response = await brokerFetch(brokerEndpoint(discovery, 'jwks_uri'))
  return readBrokerMetadata(() => {
    const jwks = brokerObject(response)
    if (!Array.isArray(jwks.keys)) throw new Error('Invalid broker signing keys')
    return createLocalJWKSet(jwks as unknown as JSONWebKeySet)
  })
}
