import type { H3Event } from 'h3'
import type { AdminAllowlistStore, ChallengeStore as WebAuthnChallengeStore, CodeStore, ConsentStore, CredentialStore, EmailHistoryStore, JtiStore, KeyStore, RecoveryStore, RefreshTokenStore, RegistrationUrlStore, UserStore } from '@openape/auth'
import type { ShapeStore } from '@openape/grants'
import type { ExtendedGrantStore } from './grant-store'
import type { ChallengeStore as GrantChallengeStore } from './grant-challenge-store'
import type { SshKeyStore } from './ssh-key-store'
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

// Consent Store (DDISA allowlist-user mode, #301)

export function defineConsentStore(factory: (event: H3Event) => ConsentStore) {
  registerStoreFactory('consentStore', factory)
}

// Admin Allowlist Store (DDISA allowlist-admin mode, #307)

export function defineAdminAllowlistStore(factory: (event: H3Event) => AdminAllowlistStore) {
  registerStoreFactory('adminAllowlistStore', factory)
}

// Recovery Token Store (account-recovery 72h-hold, #297)

export function defineRecoveryStore(factory: (event: H3Event) => RecoveryStore) {
  registerStoreFactory('recoveryStore', factory)
}

// E-mail address history (recovery warning-broadcast, #462)

export function defineEmailHistoryStore(factory: (event: H3Event) => EmailHistoryStore) {
  registerStoreFactory('emailHistoryStore', factory)
}

// Shape Store (Phase 1 — server-side shape registry)

export function defineShapeStore(factory: (event: H3Event) => ShapeStore) {
  registerStoreFactory('shapeStore', factory)
}
