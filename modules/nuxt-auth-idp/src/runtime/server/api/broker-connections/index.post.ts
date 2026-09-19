import { brokerInput } from '../../utils/broker-input'
import { createProblemError } from '../../utils/problem'
import { defineEventHandler, readBody } from 'h3'
import { brokerDomain, brokerObject, brokerOrigin } from '@openape/grants'
import { requireBrokerOwner } from '../../utils/broker-owner'
import { useBrokerStore } from '../../utils/broker-store'
import { discoverBroker } from '../../utils/broker-network'
import { getIdpIssuer } from '../../utils/stores'

export default defineEventHandler(async (event) => {
  const owner = await requireBrokerOwner(event, true)
  const { issuer, domain } = await brokerInput(async () => {
    const body = brokerObject(await readBody<unknown>(event))
    if (Object.keys(body).some(key => !['broker_issuer', 'agent_domain'].includes(key))) throw new Error('Unexpected broker connection fields')
    return { issuer: brokerOrigin(body.broker_issuer), domain: brokerDomain(body.agent_domain) }
  })
  const metadata = await discoverBroker(issuer, domain)
  if (metadata.openape_agent_domain !== domain) throw createProblemError({ status: 403, title: 'Agent provider domain does not match', type: 'https://openape.org/errors/broker_identity_mismatch' })
  return await useBrokerStore(event).createConnection({ id: crypto.randomUUID(), owner: { issuer: getIdpIssuer(), subject: owner }, broker_issuer: issuer, agent_domain: domain, status: 'active', created_at: Math.floor(Date.now() / 1000) })
})
