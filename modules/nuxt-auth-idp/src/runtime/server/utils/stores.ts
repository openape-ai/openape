import type { H3Event } from 'h3'
import type { ChallengeStore, CodeStore, CredentialStore, JtiStore, KeyStore, RefreshTokenStore, RegistrationUrlStore, UserStore } from '@openape/auth'
import { useRuntimeConfig, useEvent } from 'nitropack/runtime'
import { createChallengeStore } from './challenge-store'
import { createCodeStore } from './code-store'
import { createCredentialStore } from './credential-store'
import { createJtiStore } from './jti-store'
import { createKeyStore } from './key-store'
import { createRefreshTokenStore } from './refresh-token-store'
import { createRegistrationUrlStore } from './registration-url-store'
import { createSshKeyStore } from './ssh-key-store'
import type { SshKeyStore } from './ssh-key-store'
import { createUserStore } from './user-store'
import { createYoloPolicyStore } from './yolo-policy-store'
import type { YoloPolicyStore } from './yolo-policy-store'
import { getStoreFactory } from './store-registry'

interface IdpStores {
  userStore: UserStore
  codeStore: CodeStore
  keyStore: KeyStore
  credentialStore: CredentialStore
  challengeStore: ChallengeStore
  registrationUrlStore: RegistrationUrlStore
  jtiStore: JtiStore
  refreshTokenStore: RefreshTokenStore
  sshKeyStore: SshKeyStore
  yoloPolicyStore: YoloPolicyStore
}

let _stores: IdpStores | null = null

function initDefaultStores(): IdpStores {
  return {
    userStore: createUserStore(),
    codeStore: createCodeStore(),
    keyStore: createKeyStore(),
    credentialStore: createCredentialStore(),
    challengeStore: createChallengeStore(),
    registrationUrlStore: createRegistrationUrlStore(),
    jtiStore: createJtiStore(),
    refreshTokenStore: createRefreshTokenStore(),
    sshKeyStore: createSshKeyStore(),
    yoloPolicyStore: createYoloPolicyStore(),
  }
}

function initStoresWithRegistry(event: H3Event): IdpStores {
  return {
    userStore: getStoreFactory<UserStore>('userStore')?.(event) ?? createUserStore(),
    codeStore: getStoreFactory<CodeStore>('codeStore')?.(event) ?? createCodeStore(),
    keyStore: getStoreFactory<KeyStore>('keyStore')?.(event) ?? createKeyStore(),
    credentialStore: getStoreFactory<CredentialStore>('credentialStore')?.(event) ?? createCredentialStore(),
    challengeStore: getStoreFactory<ChallengeStore>('challengeStore')?.(event) ?? createChallengeStore(),
    registrationUrlStore: getStoreFactory<RegistrationUrlStore>('registrationUrlStore')?.(event) ?? createRegistrationUrlStore(),
    jtiStore: getStoreFactory<JtiStore>('jtiStore')?.(event) ?? createJtiStore(),
    refreshTokenStore: getStoreFactory<RefreshTokenStore>('refreshTokenStore')?.(event) ?? createRefreshTokenStore(),
    sshKeyStore: getStoreFactory<SshKeyStore>('sshKeyStore')?.(event) ?? createSshKeyStore(),
    yoloPolicyStore: getStoreFactory<YoloPolicyStore>('yoloPolicyStore')?.(event) ?? createYoloPolicyStore(),
  }
}

function getStores(): IdpStores {
  if (!_stores) {
    _stores = initDefaultStores()
  }
  return _stores
}

export function useIdpStores(): IdpStores {
  try {
    const event = useEvent()
    if (event?.context?.openapeStorageKey) {
      if (!event.context._idpStores) {
        event.context._idpStores = initStoresWithRegistry(event)
      }
      return event.context._idpStores as IdpStores
    }
    if (event) {
      if (!event.context._idpStores) {
        event.context._idpStores = initStoresWithRegistry(event)
      }
      return event.context._idpStores as IdpStores
    }
  }
  catch {}
  return getStores()
}

export function getIdpIssuer(): string {
  try {
    const event = useEvent()
    if (event?.context?.openapeIssuer) {
      return event.context.openapeIssuer.trim()
    }
  }
  catch {}
  const config = useRuntimeConfig()
  return (config.openapeIdp?.issuer || process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3000').trim()
}
