import type { IdPConfig, IdPStores } from '@openape/server/handlers'
import { useDb } from '../database/client'
import { createDrizzleChallengeStore } from '../stores/challenge-store'
import { createDrizzleCodeStore } from '../stores/code-store'
import { createDrizzleGrantStore } from '../stores/grant-store'
import { createDrizzleJtiStore } from '../stores/jti-store'
import { createDrizzleKeyStore } from '../stores/key-store'
import { createDrizzleRefreshTokenStore } from '../stores/refresh-token-store'
import { createDrizzleSshKeyStore } from '../stores/ssh-key-store'
import { createDrizzleUserStore } from '../stores/user-store'

let _stores: IdPStores | null = null
let _config: IdPConfig | null = null

export function useIdPStores(): IdPStores {
  if (!_stores) {
    const db = useDb()
    _stores = {
      userStore: createDrizzleUserStore(db),
      sshKeyStore: createDrizzleSshKeyStore(db),
      keyStore: createDrizzleKeyStore(db),
      codeStore: createDrizzleCodeStore(db),
      challengeStore: createDrizzleChallengeStore(db),
      grantStore: createDrizzleGrantStore(db),
      jtiStore: createDrizzleJtiStore(db),
      refreshTokenStore: createDrizzleRefreshTokenStore(db),
    }
  }
  return _stores
}

export function useIdPConfig(): IdPConfig {
  if (!_config) {
    const rc = useRuntimeConfig()
    const adminEmailsRaw = rc.adminEmails as string
    const adminEmails = adminEmailsRaw.split(',').map(e => e.trim()).filter(Boolean)
    _config = {
      issuer: rc.issuer as string,
      managementToken: (rc.managementToken as string) || undefined,
      sessionSecret: (rc.sessionSecret as string) || undefined,
      adminEmails: adminEmails.length > 0 ? adminEmails : undefined,
    }
  }
  return _config
}
