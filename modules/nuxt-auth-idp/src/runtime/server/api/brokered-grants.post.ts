import { brokerInput } from '../utils/broker-input'
import type { BrokeredGrant } from '@openape/core'
import { defineEventHandler, readBody, setHeader, setResponseStatus } from 'h3'
import { decodeJwt } from 'jose'
import { BROKER_REQUEST_TYPE, brokerObject, introspectGrant, issueAuthzJWT, parseBrokerRequest, sameBrokeredGrant, verifyBrokerToken } from '@openape/grants'
import { brokerVerificationKey, discoverBroker } from '../utils/broker-network'
import { useBrokerStore } from '../utils/broker-store'
import { getIdpIssuer, useIdpStores } from '../utils/stores'
import { useGrantStores } from '../utils/grant-stores'
import { parseBrokerGrantRequest } from '../utils/broker-grant-request'
import { runGrantPendingHooks } from '../utils/grant-pending-hooks'
import { createProblemError } from '../utils/problem'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const body = await brokerInput(async () => brokerObject(await readBody<unknown>(event)))
  if (Object.keys(body).length !== 1 || typeof body.assertion !== 'string' || body.assertion.length > 128 * 1024) throw createProblemError({ status: 400, title: 'A signed broker assertion is required' })
  const assertion = body.assertion
  const untrusted = await brokerInput(() => parseBrokerRequest(decodeJwt(assertion)))
  const store = useBrokerStore(event)
  const connection = await store.getConnection(untrusted.connection_id)
  if (!connection || connection.status !== 'active') throw createProblemError({ status: 403, title: 'Broker connection is missing or revoked', type: 'https://openape.org/errors/broker_connection_revoked' })
  if (untrusted.iss !== connection.broker_issuer || untrusted.owner !== connection.owner.subject || untrusted.aud !== getIdpIssuer()) throw createProblemError({ status: 403, title: 'Broker assertion does not match the authorized connection' })
  const discovery = await discoverBroker(connection.broker_issuer, connection.agent_domain)
  const verificationKey = await brokerVerificationKey(discovery)
  const request = await brokerInput(() => verifyBrokerToken(assertion, verificationKey, connection.broker_issuer, getIdpIssuer(), BROKER_REQUEST_TYPE), 401)
  await store.acceptRequest(request)
  if (request.operation === 'connection') return connection
  const provenance: BrokeredGrant = { connection_id: connection.id, broker_issuer: connection.broker_issuer, agent_issuer: connection.broker_issuer, owner: connection.owner.subject, key_id: request.key_id }
  const { grantStore } = useGrantStores()
  if (request.operation === 'create') {
    const grantRequest = await brokerInput(() => parseBrokerGrantRequest(request.request, request.sub))
    const grant = { id: crypto.randomUUID(), status: 'pending' as const, type: 'command' as const, request: grantRequest, brokered: provenance, created_at: Math.floor(Date.now() / 1000) }
    await grantStore.save(grant)
    await runGrantPendingHooks(grant)
    setResponseStatus(event, 201)
    return grant
  }
  const grant = await introspectGrant(request.grant_id, grantStore)
  if (!grant || grant.request.requester !== request.sub || !sameBrokeredGrant(grant.brokered, provenance)) throw createProblemError({ status: 403, title: 'Grant does not belong to this brokered identity' })
  if (request.operation === 'get') return grant
  if (grant.status !== 'approved' || (grant.expires_at && grant.expires_at <= Date.now() / 1000)) throw createProblemError({ status: 400, title: 'Grant is not approved or has expired', type: 'https://openape.org/errors/grant_not_approved' })
  await store.assertConnection(provenance)
  const key = await useIdpStores().keyStore.getSigningKey()
  const authzJwt = await issueAuthzJWT(grant, getIdpIssuer(), key.privateKey, key.kid)
  await store.recordToken(grant)
  return { authz_jwt: authzJwt, grant }
})
