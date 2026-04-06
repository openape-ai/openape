import type { IdPConfig, IdPStores } from '@openape/server/handlers'
import { createClient } from '@libsql/client/http'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from '../database/schema'
import { ensureTables } from '../database/migrate'
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
let _migrated = false

async function getDb() {
  const rc = useRuntimeConfig()
  const client = createClient({
    url: (rc.tursoUrl as string).trim(),
    authToken: (rc.tursoAuthToken as string)?.trim() || undefined,
  })
  const db = drizzle(client, { schema })
  if (!_migrated) {
    await ensureTables(db)
    _migrated = true
  }
  return db
}

export async function useIdPStores(): Promise<IdPStores> {
  if (!_stores) {
    const db = await getDb()
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
    const adminEmails = ((rc.adminEmails as string) || '').split(',').map(e => e.trim()).filter(Boolean)
    _config = {
      issuer: (rc.issuer as string).trim(),
      managementToken: (rc.managementToken as string)?.trim() || undefined,
      sessionSecret: (rc.sessionSecret as string)?.trim() || undefined,
      adminEmails: adminEmails.length > 0 ? adminEmails : undefined,
    }
  }
  return _config
}
