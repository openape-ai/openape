// @vitest-environment node
import { generateKeyPair } from '@openape/core'
import { BROKER_REQUEST_TYPE, BROKER_REQUESTER_NAME_CAPABILITY, verifyBrokerToken } from '@openape/grants'
import { beforeEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'

const issuer = 'https://pods.provider.test'
const decisionIssuer = 'https://id.owner.test'
const keys = await generateKeyPair()
const binding = { subject: 'agent@pods.provider.test', key_id: 'agent-key', owner: 'owner@owner.test', decision_issuer: decisionIssuer, connection_id: randomUUID() }
let capability: unknown
let user: { name: string, isActive: boolean, type: string }
let keyId: string
let assertion: string
const transport = vi.fn(async (_url: string, init: { body: string }) => { assertion = JSON.parse(init.body).assertion; return { status: 'pending' } })
vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => ({ openapeIdp: {} }) }))
vi.mock('../src/runtime/server/utils/agent-auth', () => ({ tryBearerAuth: async () => ({ sub: binding.subject, act: 'agent' }) }))
vi.mock('../src/runtime/server/utils/broker-store', () => ({ hasBrokerStore: () => true, useBrokerStore: () => ({ getAgent: async () => binding }) }))
vi.mock('../src/runtime/server/utils/broker-network', () => ({ discoverBroker: async () => ({ issuer: decisionIssuer, [BROKER_REQUESTER_NAME_CAPABILITY]: capability }), brokerEndpoint: () => `${decisionIssuer}/api/brokered-grants`, brokerFetch: (...args: Parameters<typeof transport>) => transport(...args) }))
vi.mock('../src/runtime/server/utils/stores', () => ({ getIdpIssuer: () => issuer, useIdpStores: () => ({ keyStore: { getSigningKey: async () => ({ ...keys, kid: 'provider-key' }) }, userStore: { findByEmail: async () => user }, sshKeyStore: { findByUser: async () => [{ keyId }] } }) }))
const { maybeForwardBrokerGrant } = await import('../src/runtime/server/utils/broker-forward')
const discovery = (await import('../src/runtime/server/routes/well-known/openid-configuration.get')).default

beforeEach(() => {
  capability = true
  user = { name: '  Registered briefing  ', isActive: true, type: 'agent' }
  keyId = binding.key_id
  transport.mockClear()
})

it('advertises support and signs the active registered name instead of requester-written context', async () => {
  expect(await discovery({} as never)).toHaveProperty(BROKER_REQUESTER_NAME_CAPABILITY, true)
  const request = { summary: { title: 'Unverified title', origin: 'Unverified name' } }
  await maybeForwardBrokerGrant({} as never, 'create', request)
  const claims = await verifyBrokerToken(assertion, keys.publicKey, issuer, decisionIssuer, BROKER_REQUEST_TYPE)
  expect(claims).toMatchObject({ requester_name: 'Registered briefing', sub: binding.subject, key_id: binding.key_id, request })
})

it.each([undefined, false, 'true'])('omits extra fields for a strict old peer (capability %s)', async (value) => {
  capability = value
  await maybeForwardBrokerGrant({} as never, 'get', randomUUID())
  expect(await verifyBrokerToken(assertion, keys.publicKey, issuer, decisionIssuer, BROKER_REQUEST_TYPE)).not.toHaveProperty('requester_name')
})

it.each(['', '  ', 'Hidden\u202Ename', 'x'.repeat(121)])('omits an invalid legacy registration name without blocking the operation', async (name) => {
  user.name = name
  await expect(maybeForwardBrokerGrant({} as never, 'get', randomUUID())).resolves.toEqual({ status: 'pending' })
  expect(await verifyBrokerToken(assertion, keys.publicKey, issuer, decisionIssuer, BROKER_REQUEST_TYPE)).not.toHaveProperty('requester_name')
})

it.each(['inactive', 'foreign-key'])('refuses identity validation failure before signing metadata (%s)', async (failure) => {
  if (failure === 'inactive') user.isActive = false
  else keyId = 'different-key'
  await expect(maybeForwardBrokerGrant({} as never, 'get', randomUUID())).rejects.toMatchObject({ statusCode: 403 })
  expect(transport).not.toHaveBeenCalled()
})
