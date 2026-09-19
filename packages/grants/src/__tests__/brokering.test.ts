import type { BrokerReceipt, BrokerRequest, OpenApeGrant } from '@openape/core'
import { InMemoryGrantStore } from '../stores'
import { generateKeyPair } from '@openape/core'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { BROKER_RECEIPT_TYPE, BROKER_REQUEST_TYPE, brokerDomain, brokerOrigin, parseBrokerReceipt, parseBrokerRequest, sameBrokeredGrant, signBrokerToken, verifyBrokerToken } from '../brokering'

function receipt(): BrokerReceipt {
  const now = Math.floor(Date.now() / 1000)
  return { iss: 'https://id.example.test', sub: 'owner@example.test', aud: 'https://pods.example.test', iat: now, exp: now + 300, jti: randomUUID(), connection_id: randomUUID(), agent_domain: 'pods.example.test' }
}
function request(): BrokerRequest {
  const value = receipt()
  return { iss: value.aud, aud: value.iss, owner: value.sub, iat: value.iat, exp: value.iat + 60, jti: randomUUID(), connection_id: value.connection_id, operation: 'connection' }
}
describe('typed broker assertions', () => {
  it('verifies dedicated signatures and rejects wrong keys, audiences, issuers and receipt substitution', async () => {
    const keys = await generateKeyPair()
    const other = await generateKeyPair()
    const value = request()
    const token = await signBrokerToken(value, keys.privateKey, 'broker-key', BROKER_REQUEST_TYPE)
    await expect(verifyBrokerToken(token, keys.publicKey, value.iss, value.aud, BROKER_REQUEST_TYPE)).resolves.toEqual(value)
    await expect(verifyBrokerToken(token, async () => keys.publicKey, value.iss, value.aud, BROKER_REQUEST_TYPE)).resolves.toEqual(value)
    await expect(verifyBrokerToken('x'.repeat(129 * 1024), keys.publicKey, value.iss, value.aud, BROKER_REQUEST_TYPE)).rejects.toThrow('too large')
    await expect(verifyBrokerToken(token, other.publicKey, value.iss, value.aud, BROKER_REQUEST_TYPE)).rejects.toThrow()
    await expect(verifyBrokerToken(token, keys.publicKey, value.aud, value.iss, BROKER_REQUEST_TYPE)).rejects.toThrow()
    await expect(verifyBrokerToken(token, keys.publicKey, value.iss, value.aud, BROKER_RECEIPT_TYPE)).rejects.toThrow()
    const connection = receipt()
    const proof = await signBrokerToken(connection, keys.privateKey, 'owner-key', BROKER_RECEIPT_TYPE)
    await expect(verifyBrokerToken(proof, keys.publicKey, connection.iss, connection.aud, BROKER_RECEIPT_TYPE)).resolves.toEqual(connection)
  })
  it('binds operation-specific fields and short lifetimes', () => {
    const base = request()
    expect(parseBrokerRequest(base)).toEqual(base)
    for (const operation of ['get', 'token'] as const) expect(parseBrokerRequest({ ...base, operation, sub: 'agent@pods.example.test', key_id: 'key', grant_id: randomUUID() }).operation).toBe(operation)
    expect(parseBrokerRequest({ ...base, operation: 'create', sub: 'agent@pods.example.test', key_id: 'key', request: { command: ['printf', 'test'] } }).operation).toBe('create')
    for (const delta of [{ exp: base.iat + 61 }, { exp: 1 }, { iat: base.iat + 10 }, { jti: 'reusable' }, { operation: 'approve' }, { operation: 'connection', sub: 'unexpected' }, { operation: 'get' }, { unknown: true }]) expect(() => parseBrokerRequest({ ...base, ...delta })).toThrow()
    expect(() => parseBrokerReceipt({ ...receipt(), exp: base.iat + 301 })).toThrow()
    for (const domain of ['*.example.test', 'Example.test', 'x', 'a..test']) expect(() => brokerDomain(domain)).toThrow()
    for (const origin of ['http://example.test', 'https://example.test/', 'https://example.test/path', 'https://user@example.test']) expect(() => brokerOrigin(origin)).toThrow()
  })
})

it('compares every immutable provenance field and distinguishes direct grants', () => {
  const binding = { connection_id: randomUUID(), broker_issuer: 'https://pods.example.test', agent_issuer: 'https://pods.example.test', owner: 'owner@example.test', key_id: 'key' }
  expect(sameBrokeredGrant(binding, { ...binding })).toBe(true)
  expect(sameBrokeredGrant(undefined, undefined)).toBe(true)
  expect(sameBrokeredGrant(undefined, binding)).toBe(false)
  expect(sameBrokeredGrant(binding, undefined)).toBe(false)
  for (const field of Object.keys(binding)) expect(sameBrokeredGrant(binding, { ...binding, [field]: 'changed' })).toBe(false)
})

it('rejects malformed claims at each external boundary', () => {
  const base = request()
  for (const input of [null, [], 'text', { ...base, iss: 'https://user@provider.test' }, { ...base, iat: 1.5 }, { ...base, exp: base.iat }, { ...base, connection_id: 'invalid' }, { ...base, owner: 'with space' }, { ...base, owner: '' }, { ...base, owner: 'x'.repeat(2049) }, { ...base, operation: 'create', sub: 'agent@pods.example.test', key_id: 'key', request: [] }, { ...base, operation: 'get', sub: 'agent@pods.example.test', key_id: 'key', grant_id: 'not-uuid' }]) expect(() => parseBrokerRequest(input)).toThrow()
  for (const domain of ['a'.repeat(254), 'UPPER.test', 'no dot']) expect(() => brokerDomain(domain)).toThrow()
})

it('restricts brokered inbox visibility before applying the requester filter', async () => {
  const store = new InMemoryGrantStore()
  const owner = 'owner@example.test'
  const binding = { connection_id: randomUUID(), broker_issuer: 'https://pods.example.test', agent_issuer: 'https://pods.example.test', owner, key_id: 'key' }
  const make = (requester: string, brokered?: OpenApeGrant['brokered']): OpenApeGrant => ({ id: randomUUID(), status: 'pending', created_at: 1, request: { requester, audience: 'shapes', target_host: 'fixture' }, ...(brokered ? { brokered } : {}) })
  const direct = make(owner)
  const foreign = make('agent@pods.example.test', binding)
  await store.save(direct)
  await store.save(foreign)
  await store.save(make('another@pods.example.test', { ...binding, owner: 'other@example.test' }))
  expect((await store.listGrants({ requester: [owner], brokerOwner: owner, requesterFilter: foreign.request.requester })).data).toEqual([foreign])
  expect((await store.listGrants({ requester: [owner, foreign.request.requester], brokerOwner: null })).data).toEqual([direct])
  expect((await store.listGrants({ requester: [owner], brokerOwner: owner, requesterFilter: 'another@pods.example.test' })).data).toEqual([])
})
