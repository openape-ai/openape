// @vitest-environment node
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto'
import { generateKeyPair } from '@openape/core'
import { BROKER_RECEIPT_TYPE, signBrokerToken } from '@openape/grants'
import { beforeEach, expect, it, vi } from 'vitest'

const ownerIssuer = 'https://id.owner.test'
const brokerIssuer = 'https://pods.provider.test'
const keys = await generateKeyPair()
let body: Record<string, unknown>
let connectionId: string
const bindAgent = vi.fn()
const forward = vi.fn()
vi.mock('h3', async importOriginal => ({ ...await importOriginal<typeof import('h3')>(), defineEventHandler: (handler: unknown) => handler, readBody: async () => body, setHeader: vi.fn() }))
vi.mock('nitropack/runtime', () => ({ useRuntimeConfig: () => ({ openapeIdp: { brokerAgentDomain: 'pods.provider.test' } }) }))
vi.mock('../src/runtime/server/utils/broker-network', () => ({ discoverBroker: async () => ({ issuer: ownerIssuer }), brokerVerificationKey: async () => keys.publicKey }))
vi.mock('../src/runtime/server/utils/broker-store', () => ({ useBrokerStore: () => ({ bindAgent }) }))
vi.mock('../src/runtime/server/utils/stores', () => ({ getIdpIssuer: () => brokerIssuer }))
vi.mock('../src/runtime/server/utils/broker-forward', () => ({ forwardBrokerOperation: (...args: unknown[]) => forward(...args) }))
const handler = (await import('../src/runtime/server/api/broker-agents.post')).default
async function receipt(delta: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000)
  return signBrokerToken({ iss: ownerIssuer, sub: 'owner@owner.test', aud: brokerIssuer, iat: now, exp: now + 300, jti: randomUUID(), connection_id: connectionId, agent_domain: 'pods.provider.test', ...delta }, keys.privateKey, 'owner-key', BROKER_RECEIPT_TYPE)
}
beforeEach(async () => {
  connectionId = randomUUID(); bindAgent.mockReset(); forward.mockReset().mockResolvedValue({ id: connectionId, status: 'active' })
  const key = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' })
  const wire = Buffer.concat([Buffer.from('0000000b7373682d6564323535313900000020', 'hex'), Buffer.from(key.x!, 'base64url')])
  body = { podId: randomUUID(), name: 'Synthetic pod', publicKey: `ssh-ed25519 ${wire.toString('base64')}`, connection_receipt: await receipt() }
})
it('enrolls distinct agent identities with a verified external owner and no owner access token', async () => {
  const first = await handler({} as never)
  body.podId = randomUUID()
  const second = await handler({} as never)
  expect(first.email).not.toBe(second.email)
  expect(first).toMatchObject({ owner: 'owner@owner.test', decisionIssuer: ownerIssuer, brokerConnectionId: connectionId, permissions: 'none' })
  expect(first.email).toMatch(/^pod-[a-f0-9]+@pods\.provider\.test$/)
  const keyId = createHash('sha256').update(Buffer.from(String(body.publicKey).split(' ')[1]!, 'base64')).digest('hex')
  expect(bindAgent).toHaveBeenCalledWith(expect.objectContaining({ owner: first.owner, decision_issuer: ownerIssuer, connection_id: connectionId, key_id: keyId }), 'Synthetic pod', body.publicKey)
  expect(forward).toHaveBeenCalledWith(expect.objectContaining({ owner: first.owner }), 'connection')
})
it('refuses substituted recipients, agent domains and revoked owner consent before persisting an identity', async () => {
  body.connection_receipt = await receipt({ aud: 'https://another.provider.test' })
  await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 401 })
  body.connection_receipt = await receipt({ agent_domain: 'another.provider.test' })
  await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 403 })
  body.connection_receipt = await receipt()
  forward.mockResolvedValue({ id: connectionId, status: 'revoked' })
  await expect(handler({} as never)).rejects.toMatchObject({ statusCode: 403 })
  expect(bindAgent).not.toHaveBeenCalled()
})
