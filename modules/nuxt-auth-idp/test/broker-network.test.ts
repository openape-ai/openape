// @vitest-environment node
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, expect, it, vi } from 'vitest'

const dns = vi.hoisted(() => vi.fn())
const outgoing = vi.hoisted(() => vi.fn())
vi.mock('node:dns/promises', () => ({ lookup: dns }))
vi.mock('node:https', () => ({ request: outgoing }))
const { brokerFetch, brokerEndpoint, brokerVerificationKey } = await import('../src/runtime/server/utils/broker-network')
afterEach(() => { vi.resetAllMocks() })
it('pins the validated public address and does not follow redirects or return remote error bodies', async () => {
  dns.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  let statusCode = 200
  outgoing.mockImplementation((_url, options, receive) => {
    const reply = Object.assign(new PassThrough(), { statusCode })
    const request = Object.assign(new EventEmitter(), { end: () => { receive(reply); reply.end('{"fixture":true}') } })
    options.lookup('changed.example.test', { all: true }, (error: unknown, addresses: unknown) => { expect(error).toBeNull(); expect(addresses).toEqual([{ address: '93.184.216.34', family: 4 }]) })
    return request
  })
  await expect(brokerFetch('https://provider.example.test/metadata')).resolves.toEqual({ fixture: true })
  expect(dns).toHaveBeenCalledTimes(1)
  statusCode = 302
  await expect(brokerFetch('https://provider.example.test/metadata')).rejects.toMatchObject({ statusCode: 503 })
  expect(outgoing).toHaveBeenCalledTimes(2)
})
it('rejects loopback, private, IPv4-mapped IPv6 and mixed public/private DNS answers before connecting', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '::1', '::ffff:7f00:1', '64:ff9b::7f00:1']) {
    dns.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address, family: address.includes(':') ? 6 : 4 }])
    await expect(brokerFetch('https://provider.example.test/metadata')).rejects.toThrow('private addresses')
  }
  expect(outgoing).not.toHaveBeenCalled()
})

it('reports malformed provider endpoints and signing keys as an unavailable dependency', async () => {
  const discovery = { issuer: 'https://provider.example.test', jwks_uri: 'https://provider.example.test/jwks' }
  for (const value of [undefined, 'not a URL', 'https://foreign.test/jwks', 'https://provider.example.test/jwks?token=unexpected']) {
    expect(() => brokerEndpoint({ ...discovery, jwks_uri: value }, 'jwks_uri')).toThrow(expect.objectContaining({ statusCode: 503 }))
  }
  dns.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  outgoing.mockImplementation((_url, _options, receive) => {
    const reply = Object.assign(new PassThrough(), { statusCode: 200 })
    return Object.assign(new EventEmitter(), { end: () => { receive(reply); reply.end('{"keys":"invalid"}') } })
  })
  await expect(brokerVerificationKey(discovery)).rejects.toMatchObject({ statusCode: 503 })
})

it('keeps the provider\'s Retry-After on a rate-limit refusal', async () => {
  dns.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  let headers: Record<string, string> = { 'retry-after': '23' }
  outgoing.mockImplementation((_url, _options, receive) => {
    const reply = Object.assign(new PassThrough(), { statusCode: 429, headers })
    return Object.assign(new EventEmitter(), { end: () => { receive(reply); reply.end('{}') } })
  })
  await expect(brokerFetch('https://provider.example.test/brokered', { method: 'POST' })).rejects.toMatchObject({ statusCode: 429, data: { retry_after: 23 } })
  headers = { 'retry-after': 'soon' }
  const unparsable = await brokerFetch('https://provider.example.test/brokered', { method: 'POST' }).catch((error: { data: Record<string, unknown> }) => error)
  expect(unparsable).toMatchObject({ statusCode: 429 })
  expect(unparsable.data.retry_after).toBeUndefined()
})

it('relays a definite refusal of a too large request, but reports provider failures as unavailable', async () => {
  dns.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  let statusCode = 413
  outgoing.mockImplementation((_url, _options, receive) => {
    const reply = Object.assign(new PassThrough(), { statusCode })
    return Object.assign(new EventEmitter(), { end: () => { receive(reply); reply.end('{}') } })
  })
  await expect(brokerFetch('https://provider.example.test/brokered', { method: 'POST', relayRefusal: true })).rejects.toMatchObject({ statusCode: 413 })
  statusCode = 500
  await expect(brokerFetch('https://provider.example.test/brokered', { method: 'POST', relayRefusal: true })).rejects.toMatchObject({ statusCode: 503 })
})

it.each(['denied', 'revoked', 'expired', 'used'])('relays a 403 body only when it carries a definite %s state', async (state) => {
  dns.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  let body = JSON.stringify({ state, grant_id: 'g-1' })
  outgoing.mockImplementation((_url, _options, receive) => {
    const reply = Object.assign(new PassThrough(), { statusCode: 403 })
    return Object.assign(new EventEmitter(), { end: () => { receive(reply); reply.end(body) } })
  })
  await expect(brokerFetch('https://provider.example.test/brokered', { method: 'POST', relayRefusal: true })).resolves.toEqual({ state, grant_id: 'g-1' })
  await expect(brokerFetch('https://provider.example.test/brokered', { method: 'POST' })).rejects.toMatchObject({ statusCode: 403 })
  body = '{"title":"Broker connection is missing or revoked"}'
  await expect(brokerFetch('https://provider.example.test/brokered', { method: 'POST', relayRefusal: true })).rejects.toMatchObject({ statusCode: 403 })
})
