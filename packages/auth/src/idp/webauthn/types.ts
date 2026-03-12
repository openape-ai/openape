import type { AuthenticatorTransportFuture, CredentialDeviceType } from '@simplewebauthn/types'

export interface WebAuthnCredential {
  credentialId: string
  userEmail: string
  publicKey: string // Base64URL-encoded
  counter: number
  transports?: AuthenticatorTransportFuture[]
  deviceType: CredentialDeviceType
  backedUp: boolean
  createdAt: number
  name?: string
}

export interface WebAuthnChallenge {
  challenge: string
  userEmail?: string
  type: 'registration' | 'authentication'
  expiresAt: number
}

export interface RegistrationUrl {
  token: string
  email: string
  name: string
  createdAt: number
  expiresAt: number
  createdBy: string
  consumed: boolean
}

export interface CredentialStore {
  save: (credential: WebAuthnCredential) => Promise<void>
  findById: (credentialId: string) => Promise<WebAuthnCredential | null>
  findByUser: (email: string) => Promise<WebAuthnCredential[]>
  delete: (credentialId: string) => Promise<void>
  deleteAllForUser: (email: string) => Promise<void>
  updateCounter: (credentialId: string, counter: number) => Promise<void>
}

export interface ChallengeStore {
  save: (token: string, challenge: WebAuthnChallenge) => Promise<void>
  find: (token: string) => Promise<WebAuthnChallenge | null>
  consume: (token: string) => Promise<WebAuthnChallenge | null>
}

export interface RegistrationUrlStore {
  save: (reg: RegistrationUrl) => Promise<void>
  find: (token: string) => Promise<RegistrationUrl | null>
  consume: (token: string) => Promise<RegistrationUrl | null>
  list: () => Promise<RegistrationUrl[]>
  delete: (token: string) => Promise<void>
}

export interface RPConfig {
  rpName: string
  rpID: string
  origin: string
  requireUserVerification?: boolean
  residentKey?: 'preferred' | 'required' | 'discouraged'
  attestationType?: 'none' | 'indirect' | 'direct' | 'enterprise'
}
