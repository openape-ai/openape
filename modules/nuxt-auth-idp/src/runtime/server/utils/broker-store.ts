import type { H3Event } from 'h3'
import type { BrokerConnection, BrokeredGrant, BrokerRequest, OpenApeAuthZClaims, OpenApeGrant } from '@openape/core'
import { getStoreFactory, registerStoreFactory } from './store-registry'
import { createProblemError } from './problem'

export interface BrokerAgentBinding {
  subject: string
  key_id: string
  owner: string
  decision_issuer: string
  connection_id: string
}

export interface BrokerStore {
  createConnection: (connection: BrokerConnection) => Promise<BrokerConnection>
  listConnections: (owner: string) => Promise<BrokerConnection[]>
  getConnection: (id: string) => Promise<BrokerConnection | null>
  revokeConnection: (id: string, owner: string) => Promise<void>
  acceptRequest: (request: BrokerRequest) => Promise<BrokerConnection>
  assertConnection: (provenance: BrokeredGrant) => Promise<void>
  recordToken: (grant: OpenApeGrant) => Promise<void>
  consume: (grantId: string, claims: OpenApeAuthZClaims) => Promise<{ status: string, error?: string, grant?: OpenApeGrant }>
  getAgent: (subject: string) => Promise<BrokerAgentBinding | null>
  bindAgent: (binding: BrokerAgentBinding, name: string, publicKey: string) => Promise<void>
}

export function defineBrokerStore(factory: (event: H3Event) => BrokerStore): void {
  registerStoreFactory('brokerStore', factory)
}

export function hasBrokerStore(): boolean {
  return !!getStoreFactory<BrokerStore>('brokerStore')
}

export function useBrokerStore(event: H3Event): BrokerStore {
  const factory = getStoreFactory<BrokerStore>('brokerStore')
  if (!factory) throw createProblemError({ status: 503, title: 'Grant brokering is not configured', type: 'https://openape.org/errors/broker_unavailable' })
  return factory(event)
}
