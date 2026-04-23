import type { H3Event } from 'h3'
import type { ChallengeStore as WebAuthnChallengeStore, CodeStore, CredentialStore, JtiStore, KeyStore, RefreshTokenStore, RegistrationUrlStore, UserStore } from '@openape/auth'
import type { ShapeStore } from '@openape/grants'
import type { ExtendedGrantStore } from './grant-store'
import type { ChallengeStore as GrantChallengeStore } from './grant-challenge-store'
import type { SshKeyStore } from './ssh-key-store'
import type { YoloPolicyStore } from './yolo-policy-store'
import { registerStoreFactory } from './store-registry'

// Grant Stores (Gruppe B)

export function defineGrantStore(factory: (event: H3Event) => ExtendedGrantStore) {
  registerStoreFactory('grantStore', factory)
}

export function defineGrantChallengeStore(factory: (event: H3Event) => GrantChallengeStore) {
  registerStoreFactory('grantChallengeStore', factory)
}

// IdP Stores (Gruppe A)

export function defineUserStore(factory: (event: H3Event) => UserStore) {
  registerStoreFactory('userStore', factory)
}

export function defineCodeStore(factory: (event: H3Event) => CodeStore) {
  registerStoreFactory('codeStore', factory)
}

export function defineKeyStore(factory: (event: H3Event) => KeyStore) {
  registerStoreFactory('keyStore', factory)
}

export function defineCredentialStore(factory: (event: H3Event) => CredentialStore) {
  registerStoreFactory('credentialStore', factory)
}

export function defineWebAuthnChallengeStore(factory: (event: H3Event) => WebAuthnChallengeStore) {
  registerStoreFactory('challengeStore', factory)
}

export function defineRegistrationUrlStore(factory: (event: H3Event) => RegistrationUrlStore) {
  registerStoreFactory('registrationUrlStore', factory)
}

export function defineJtiStore(factory: (event: H3Event) => JtiStore) {
  registerStoreFactory('jtiStore', factory)
}

export function defineRefreshTokenStore(factory: (event: H3Event) => RefreshTokenStore) {
  registerStoreFactory('refreshTokenStore', factory)
}

// SSH Key Store

export function defineSshKeyStore(factory: (event: H3Event) => SshKeyStore) {
  registerStoreFactory('sshKeyStore', factory)
}

// Shape Store (Phase 1 — server-side shape registry)

export function defineShapeStore(factory: (event: H3Event) => ShapeStore) {
  registerStoreFactory('shapeStore', factory)
}

// YOLO Policy Store (per-agent auto-approval)

export function defineYoloPolicyStore(factory: (event: H3Event) => YoloPolicyStore) {
  registerStoreFactory('yoloPolicyStore', factory)
}
