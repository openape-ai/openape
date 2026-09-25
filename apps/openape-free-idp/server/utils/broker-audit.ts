import type { OpenApeGrant } from '@openape/core'

export function brokerAuditRow(grant: OpenApeGrant, event: string) {
  if (!grant.brokered) throw new Error('Broker audit requires grant provenance')
  return { grantId: grant.id, owner: grant.brokered.owner, agent: grant.request.requester, brokerIssuer: grant.brokered.broker_issuer, connectionId: grant.brokered.connection_id, event, createdAt: Math.floor(Date.now() / 1000) }
}
