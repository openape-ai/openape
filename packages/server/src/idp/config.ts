import type { CodeStore, GrantChallengeStore, JtiStore, KeyStore, RefreshTokenStore, SshKeyStore, UserStore } from '@openape/auth'
import type { GrantStore } from '@openape/grants'

export interface IdPConfig {
  issuer: string
  adminEmails?: string[]
  managementToken?: string
  /** Secret for cookie session encryption (min 32 chars). */
  sessionSecret?: string
}

export interface IdPStores {
  userStore: UserStore
  sshKeyStore: SshKeyStore
  keyStore: KeyStore
  codeStore: CodeStore
  challengeStore: GrantChallengeStore
  grantStore: GrantStore
  jtiStore: JtiStore
  refreshTokenStore: RefreshTokenStore
}

export interface IdPInstance {
  app: import('h3').App
  stores: IdPStores
}
