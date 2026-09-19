import { defineEventHandler, getRouterParam, setHeader } from 'h3'
import { BROKER_RECEIPT_TYPE, signBrokerToken } from '@openape/grants'
import { requireBrokerOwner } from '../../../utils/broker-owner'
import { useBrokerStore } from '../../../utils/broker-store'
import { getIdpIssuer, useIdpStores } from '../../../utils/stores'
import { createProblemError } from '../../../utils/problem'

export default defineEventHandler(async (event) => {
  const owner = await requireBrokerOwner(event, true)
  const id = getRouterParam(event, 'id')
  const connection = id ? await useBrokerStore(event).getConnection(id) : null
  if (!connection || connection.owner.subject !== owner || connection.status !== 'active') throw createProblemError({ status: 403, title: 'An active owner-authorized broker connection is required' })
  const key = await useIdpStores().keyStore.getSigningKey()
  const now = Math.floor(Date.now() / 1000)
  setHeader(event, 'Cache-Control', 'no-store')
  return { connection_receipt: await signBrokerToken({ iss: getIdpIssuer(), sub: owner, aud: connection.broker_issuer, iat: now, exp: now + 300, jti: crypto.randomUUID(), connection_id: connection.id, agent_domain: connection.agent_domain }, key.privateKey, key.kid, BROKER_RECEIPT_TYPE) }
})
