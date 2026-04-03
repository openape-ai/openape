import type { ChallengeStore, CodeStore, ConsentStore, JtiStore, KeyStore, RefreshTokenStore } from '@openape/auth'
import type { GrantStore } from '@openape/grants'

export interface IdPConfig {
  issuer: string
  adminEmails?: string[]
  managementToken?: string
}

export interface IdPStores {
  // TODO: Add UserStore and SshKeyStore once M1 (store interfaces) is merged
  keyStore: KeyStore
  codeStore: CodeStore
  consentStore: ConsentStore
  challengeStore: ChallengeStore
  grantStore: GrantStore
  jtiStore: JtiStore
  refreshTokenStore: RefreshTokenStore
}

export interface IdPInstance {
  app: import('h3').App
  stores: IdPStores
}
