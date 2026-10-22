import type { WebAuthnCredential } from '@openape/auth'
import type { DeliveryContext, Envelope, SecretPayload, WrappedKey } from '@openape/ape-secrets/vault'

export interface Principal { subject: string, actor: string, act: 'human' | 'agent', authentication: 'session' | 'bearer', session: string }
export interface Vault { id: string, owner: string, recoveryPublicKey: JsonWebKey, recoveryWrapper: WrappedKey, recoveryPrivateKey: WrappedKey, recoveryId: string }
export interface Credential { id: string, owner: string, credential: WebAuthnCredential, input: string, wrapper: WrappedKey, disabled: boolean }
export interface Secret { id: string, owner: string, alias: string, version: number, payload: SecretPayload, deleted: boolean }
export interface Consumer { id: string, owner: string, name: string, collector: string, publicKey: JsonWebKey, fingerprint: string, disabled: boolean }
export interface Request {
  id: string,
  owner: string,
  requester: string,
  consumerId: string,
  fingerprint: string
  secretId: string,
  version: number,
  purpose: string,
  expiresAt: number
  status: 'pending' | 'approved' | 'denied' | 'cancelled' | 'expired'
  approvalId?: string
}
export interface Approval {
  id: string,
  owner: string,
  credentialId: string,
  descriptor: DeliveryContext,
  envelope: Envelope | null
  status: 'active' | 'consumed' | 'revoked' | 'superseded',
  createdAt: number,
  consumedAt?: number
}
export type Action =
  | { type: 'save', secretId: string, alias: string, version: number }
  | { type: 'bind', consumerId: string, collector: string, fingerprint: string }
  | { type: 'approve', requestId: string, descriptor: DeliveryContext }
  | { type: 'enroll' }
  | { type: 'unlock' }
export interface Challenge {
  id: string,
  owner: string,
  session: string,
  challenge: string,
  expiresAt: number
  purpose: 'setup' | 'setup-confirm' | 'action' | 'enroll' | 'enroll-confirm' | 'recovery'
  authorizedBy?: string
  action?: Action,
  credentialId?: string,
  provisional?: WebAuthnCredential,
  input?: string,
  consumed?: boolean
}
