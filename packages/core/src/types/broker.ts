import type { OpenApeGrantRequest } from './index.js'

export interface BrokeredGrant {
  connection_id: string
  broker_issuer: string
  agent_issuer: string
  owner: string
  key_id: string
}

export interface BrokerConnection {
  id: string
  owner: { issuer: string, subject: string }
  broker_issuer: string
  agent_domain: string
  status: 'active' | 'revoked'
  created_at: number
}

export interface BrokerReceipt {
  iss: string
  sub: string
  aud: string
  iat: number
  exp: number
  jti: string
  connection_id: string
  agent_domain: string
}

interface BrokerRequestBase {
  iss: string
  aud: string
  iat: number
  exp: number
  jti: string
  connection_id: string
  owner: string
}
export type BrokerRequest = BrokerRequestBase & (
  | { operation: 'connection' }
  | { operation: 'create', sub: string, key_id: string, request: OpenApeGrantRequest }
  | { operation: 'get' | 'token', sub: string, key_id: string, grant_id: string }
)
