import type { OpenApeGrantBatch, OpenApeGrantRequest, OpenApeGrantSummary } from './index.js'

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
  | { operation: 'authorize', sub: string, key_id: string, request: OpenApeProgramAuthorizeRequest }
  | { operation: 'get' | 'token', sub: string, key_id: string, grant_id: string }
)

/**
 * Body of `POST /api/grants/authorize` and of the `authorize` broker
 * operation: one program call the IdP resolves and decides itself. The
 * requester never sends authorization details for programs.
 */
export interface OpenApeProgramAuthorizeRequest {
  target_host: string
  audience: string
  /** `name` is the basename of the executable, `sha256` the 64 lowercase hex digest of its file. */
  program: { name: string, sha256: string }
  /** Arguments without the executable, exactly as executed. */
  argv: string[]
  files?: { path: string, sha256: string }[]
  grant_type: 'always' | 'once'
  summary?: OpenApeGrantSummary
  batch?: OpenApeGrantBatch
}

/** Answer of `POST /api/grants/authorize` (200, 202 or 403 by `state`). */
export type OpenApeProgramAuthorizeResponse =
  | { state: 'approved', grant_id: string, authz_jwt: string, expires_at: number }
  | { state: 'pending', grant_id: string, approval_url: string }
  | { state: 'denied' | 'revoked', grant_id: string }
