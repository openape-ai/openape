import type { CodeStore, GrantChallengeStore, JtiStore, KeyStore, RefreshTokenStore, SshKeyStore, UserStore } from '@openape/auth'
import type { GrantStore } from '@openape/grants'
import type { RateLimitConfig } from './middleware/rate-limit.js'

export interface IdPConfig {
  issuer: string
  adminEmails?: string[]
  managementToken?: string
  /** Secret for cookie session encryption (min 32 chars). */
  sessionSecret?: string
  /** Rate limiting configuration. When provided, rate limiting is enabled. */
  rateLimitConfig?: RateLimitConfig
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
