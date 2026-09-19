import type { BrokerReceipt, BrokerRequest, OpenApeGrant } from '@openape/core'
import { generateKeyPair } from '@openape/core'
import { BROKER_RECEIPT_TYPE, BROKER_REQUEST_TYPE, issueAuthzJWT, signBrokerToken } from '@openape/grants'
import { decodeJwt } from 'jose'
import { expect, it } from 'vitest'
import { getValidator } from './harness'

it('validates emitted connection receipts, signed requests, grants and authorization provenance against the protocol', async () => {
  const now = Math.floor(Date.now() / 1000)
  const connectionId = crypto.randomUUID()
  const receipt: BrokerReceipt = { iss: 'https://id.owner.test', sub: 'owner@owner.test', aud: 'https://pods.provider.test', iat: now, exp: now + 300, jti: crypto.randomUUID(), connection_id: connectionId, agent_domain: 'pods.provider.test' }
  const grant: OpenApeGrant = { id: crypto.randomUUID(), type: 'command', status: 'approved', request: { requester: 'agent@pods.provider.test', target_host: 'fixture', audience: 'shapes', grant_type: 'once', command: ['printf', 'fixture'] }, created_at: now, decided_at: now, decided_by: receipt.sub, brokered: { connection_id: connectionId, broker_issuer: receipt.aud, agent_issuer: receipt.aud, owner: receipt.sub, key_id: 'fixture-key' } }
  const request: BrokerRequest = { iss: receipt.aud, aud: receipt.iss, owner: receipt.sub, iat: now, exp: now + 60, jti: crypto.randomUUID(), connection_id: connectionId, operation: 'create', sub: grant.request.requester, key_id: 'fixture-key', request: grant.request }
  const keys = await generateKeyPair()
  for (const [schema, value] of [
    ['broker-connection-claims.json', decodeJwt(await signBrokerToken(receipt, keys.privateKey, 'key', BROKER_RECEIPT_TYPE))],
    ['broker-request-claims.json', decodeJwt(await signBrokerToken(request, keys.privateKey, 'key', BROKER_REQUEST_TYPE))],
    ['grant.json', grant],
    ['authz-jwt-claims.json', decodeJwt(await issueAuthzJWT(grant, receipt.iss, keys.privateKey, 'key'))],
  ] as const) {
    const result = getValidator(schema).validate(value)
    expect(result.valid, result.errors).toBe(true)
  }
  expect(getValidator('broker-request-claims.json').validate({ ...request, operation: 'approve' }).valid).toBe(false)
  expect(getValidator('grant.json').validate({ ...grant, brokered: { ...grant.brokered, key_id: undefined } }).valid).toBe(false)
})
