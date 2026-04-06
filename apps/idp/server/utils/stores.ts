import type { CodeStore, GrantChallengeStore, JtiStore, KeyStore, RefreshTokenStore, SshKeyStore, UserStore } from '@openape/auth'
import type { GrantStore } from '@openape/grants'
import { createDrizzleChallengeStore } from '../stores/challenge-store'
import { createDrizzleCodeStore } from '../stores/code-store'
import { createDrizzleGrantStore } from '../stores/grant-store'
import { createDrizzleJtiStore } from '../stores/jti-store'
import { createDrizzleKeyStore } from '../stores/key-store'
import { createDrizzleRefreshTokenStore } from '../stores/refresh-token-store'
import { createDrizzleSshKeyStore } from '../stores/ssh-key-store'
import { createDrizzleUserStore } from '../stores/user-store'

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

let _stores: IdPStores | null = null

export async function getStores(): Promise<IdPStores> {
  if (!_stores) {
    const db = await useDb()
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
