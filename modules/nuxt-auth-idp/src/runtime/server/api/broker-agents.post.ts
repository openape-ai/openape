import { createProblemError } from '../utils/problem'
import { brokerInput } from '../utils/broker-input'
import { createHash } from 'node:crypto'
import { BROKER_RECEIPT_TYPE, brokerDomain, brokerObject, parseBrokerReceipt, verifyBrokerToken } from '@openape/grants'
import { defineEventHandler, readBody, setHeader } from 'h3'
import { decodeJwt } from 'jose'
import { useRuntimeConfig } from 'nitropack/runtime'
import { brokerVerificationKey, discoverBroker } from '../utils/broker-network'
import { useBrokerStore } from '../utils/broker-store'
import { forwardBrokerOperation } from '../utils/broker-forward'
import { getIdpIssuer } from '../utils/stores'
import { parsePodEnrollment } from '../utils/pod-enrollment'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const body = await brokerInput(async () => brokerObject(await readBody<unknown>(event)))
  const receipt = body.connection_receipt
  if (typeof receipt !== 'string' || receipt.length > 16384) throw createProblemError({ status: 400, title: 'A connection receipt is required', type: 'https://openape.org/errors/broker_connection_required' })
  const fields = { ...body }
  delete fields.connection_receipt
  const enrollment = parsePodEnrollment(fields)
  const untrusted = await brokerInput(() => parseBrokerReceipt(decodeJwt(receipt)))
  const discovery = await discoverBroker(untrusted.iss, untrusted.sub.split('@')[1] ?? '')
  const verificationKey = await brokerVerificationKey(discovery)
  const verified = await brokerInput(() => verifyBrokerToken(receipt, verificationKey, untrusted.iss, getIdpIssuer(), BROKER_RECEIPT_TYPE), 401)
  const domain = brokerDomain(useRuntimeConfig().openapeIdp.brokerAgentDomain)
  if (verified.agent_domain !== domain) throw createProblemError({ status: 403, title: 'Receipt agent domain does not match this provider', type: 'https://openape.org/errors/broker_identity_mismatch' })
  const subject = `pod-${createHash('sha256').update(`${verified.iss}\0${verified.sub}\0${enrollment.podId}`).digest('hex').slice(0, 32)}@${domain}`
  const keyId = createHash('sha256').update(Buffer.from(enrollment.publicKey.split(' ')[1] ?? '', 'base64')).digest('hex')
  const binding = { subject, key_id: keyId, owner: verified.sub, decision_issuer: verified.iss, connection_id: verified.connection_id }
  const connection = brokerObject(await forwardBrokerOperation(binding, 'connection'))
  if (connection.id !== verified.connection_id || connection.status !== 'active') throw createProblemError({ status: 403, title: 'The owner connection is no longer active', type: 'https://openape.org/errors/broker_connection_revoked' })
  await useBrokerStore(event).bindAgent(binding, enrollment.name, enrollment.publicKey)
  return { email: subject, owner: verified.sub, permissions: 'none', keyId, decisionIssuer: verified.iss, brokerConnectionId: verified.connection_id }
})
