import { parseGrantReference } from './grant-reference.js'
import type { BrokeredGrant, BrokerReceipt, BrokerRequest } from '@openape/core'
import type { JWTVerifyGetKey, KeyLike } from 'jose'
import { jwtVerify, SignJWT } from 'jose'

export const BROKER_REQUEST_TYPE = 'openape-broker-request+jwt'
export const BROKER_RECEIPT_TYPE = 'openape-broker-connection+jwt'
export const BROKER_REQUESTER_NAME_CAPABILITY = 'openape_broker_requester_name_supported'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function brokerObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a broker object')
  return value as Record<string, unknown>
}

export function brokerString(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 2048 || [...value].some(character => character.charCodeAt(0) <= 32)) throw new Error('Invalid broker identity field')
  return value
}

export function brokerOrigin(value: unknown): string {
  const input = brokerString(value)
  const url = new URL(input)
  if (url.protocol !== 'https:' || url.origin !== input || url.username || url.password) throw new Error('Broker issuer must be an HTTPS origin')
  return input
}

export function brokerDomain(value: unknown): string {
  const domain = brokerString(value)
  if (domain !== domain.toLowerCase() || domain.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domain)) throw new Error('Invalid agent domain')
  return domain
}

export function brokerRequesterName(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim() || [...value].length > 120 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value)) return undefined
  return value.trim()
}

export function parseBrokerRequesterName(value: unknown): string {
  const name = brokerRequesterName(value)
  if (name === undefined) throw new Error('Invalid broker requester name')
  return name
}

export function brokeredGrantAuthority(value: BrokeredGrant): BrokeredGrant {
  const { connection_id, broker_issuer, agent_issuer, owner, key_id } = value
  return { connection_id, broker_issuer, agent_issuer, owner, key_id }
}

function fields(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unknown broker fields')
}

function tokenClaims(value: Record<string, unknown>, lifetime: number): void {
  brokerOrigin(value.iss)
  brokerOrigin(value.aud)
  if (!UUID.test(brokerString(value.jti)) || !UUID.test(brokerString(value.connection_id))) throw new Error('Invalid broker request identifier')
  const now = Math.floor(Date.now() / 1000)
  if (!Number.isInteger(value.iat) || !Number.isInteger(value.exp) || Number(value.iat) > now || Number(value.exp) <= now || Number(value.exp) <= Number(value.iat) || Number(value.exp) - Number(value.iat) > lifetime) throw new Error('Invalid broker token lifetime')
}

export function parseBrokerRequest(input: unknown): BrokerRequest {
  const value = brokerObject(input)
  const common = ['iss', 'aud', 'iat', 'exp', 'jti', 'connection_id', 'owner', 'operation']
  tokenClaims(value, 60)
  brokerString(value.owner)
  if (value.operation === 'connection') {
    fields(value, common)
    return value as unknown as BrokerRequest
  }
  brokerString(value.sub)
  brokerString(value.key_id)
  const name = value.requester_name === undefined ? undefined : parseBrokerRequesterName(value.requester_name)
  if (value.operation === 'create' || value.operation === 'authorize') {
    fields(value, [...common, 'sub', 'key_id', 'requester_name', 'request'])
    brokerObject(value.request)
  }
  else if (value.operation === 'get' && value.reference !== undefined) {
    fields(value, [...common, 'sub', 'key_id', 'requester_name', 'reference'])
    parseGrantReference(value.reference)
  }
  else if (value.operation === 'get' || value.operation === 'token') {
    fields(value, [...common, 'sub', 'key_id', 'requester_name', 'grant_id'])
    if (!UUID.test(brokerString(value.grant_id))) throw new Error('Invalid grant identifier')
  }
  else {
    throw new Error('Unsupported broker operation')
  }
  return { ...value, ...(name !== undefined ? { requester_name: name } : {}) } as unknown as BrokerRequest
}

export function parseBrokerReceipt(input: unknown): BrokerReceipt {
  const value = brokerObject(input)
  fields(value, ['iss', 'sub', 'aud', 'iat', 'exp', 'jti', 'connection_id', 'agent_domain'])
  tokenClaims(value, 300)
  brokerString(value.sub)
  brokerDomain(value.agent_domain)
  return value as unknown as BrokerReceipt
}

export function sameBrokeredGrant(left: BrokeredGrant | undefined, right: BrokeredGrant | undefined): boolean {
  if (!left || !right) return left === right
  return left.connection_id === right.connection_id && left.broker_issuer === right.broker_issuer && left.agent_issuer === right.agent_issuer && left.owner === right.owner && left.key_id === right.key_id
}

export async function signBrokerToken(claims: BrokerRequest | BrokerReceipt, key: KeyLike, kid: string, type: typeof BROKER_REQUEST_TYPE | typeof BROKER_RECEIPT_TYPE): Promise<string> {
  return await new SignJWT({ ...claims }).setProtectedHeader({ alg: 'EdDSA', typ: type, kid }).sign(key)
}

export async function verifyBrokerToken(token: string, key: KeyLike | Uint8Array | JWTVerifyGetKey, issuer: string, audience: string, type: typeof BROKER_REQUEST_TYPE): Promise<BrokerRequest>
export async function verifyBrokerToken(token: string, key: KeyLike | Uint8Array | JWTVerifyGetKey, issuer: string, audience: string, type: typeof BROKER_RECEIPT_TYPE): Promise<BrokerReceipt>
export async function verifyBrokerToken(token: string, key: KeyLike | Uint8Array | JWTVerifyGetKey, issuer: string, audience: string, type: string): Promise<BrokerRequest | BrokerReceipt> {
  if (token.length > 128 * 1024) throw new Error('Broker token is too large')
  const options = { algorithms: ['EdDSA'], issuer, audience, typ: type }
  const result = typeof key === 'function' ? await jwtVerify(token, key, options) : await jwtVerify(token, key, options)
  return type === BROKER_REQUEST_TYPE ? parseBrokerRequest(result.payload) : parseBrokerReceipt(result.payload)
}
