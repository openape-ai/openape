import type { H3Event } from 'h3'
import type { ChallengeStore, ClientMetadata, ClientMetadataStore, CodeStore, ConsentStore, CredentialStore, JtiStore, KeyStore, RefreshTokenStore, RegistrationUrlStore, UserStore } from '@openape/auth'
import { createClientMetadataResolver } from '@openape/auth'
import { useRuntimeConfig, useEvent } from 'nitropack/runtime'
import { createChallengeStore } from './challenge-store'
import { createCodeStore } from './code-store'
import { createConsentStore } from './consent-store'
import { createCredentialStore } from './credential-store'
import { createJtiStore } from './jti-store'
import { createKeyStore } from './key-store'
import { createRefreshTokenStore } from './refresh-token-store'
import { createRegistrationUrlStore } from './registration-url-store'
import { createSshKeyStore } from './ssh-key-store'
import type { SshKeyStore } from './ssh-key-store'
import { createUserStore } from './user-store'
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
  clientMetadataStore: ClientMetadataStore
  consentStore: ConsentStore
}

// Module-level singleton for the SP client-metadata resolver. The
// resolver caches its own results internally; sharing one instance
// across requests keeps the cache hit-rate up. Per-request scoping
// via `event.context` doesn't help here because the cache TTL is
// O(minutes), much longer than a request lifetime.
let _clientMetadataStore: ClientMetadataStore | null = null
function getClientMetadataStore(): ClientMetadataStore {
  if (_clientMetadataStore) return _clientMetadataStore
  let publicClients: Record<string, ClientMetadata> = {}
  try {
    const config = useRuntimeConfig()
    const raw = config.openapeIdp?.publicClients
    if (typeof raw === 'string' && raw.trim()) {
      publicClients = JSON.parse(raw) as Record<string, ClientMetadata>
    }
    else if (raw && typeof raw === 'object') {
      publicClients = raw as Record<string, ClientMetadata>
    }
  }
  catch {
    publicClients = {}
  }
  _clientMetadataStore = createClientMetadataResolver({ publicClients })
  return _clientMetadataStore
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
    clientMetadataStore: getClientMetadataStore(),
    consentStore: createConsentStore(),
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
    clientMetadataStore: getStoreFactory<ClientMetadataStore>('clientMetadataStore')?.(event) ?? getClientMetadataStore(),
    consentStore: getStoreFactory<ConsentStore>('consentStore')?.(event) ?? createConsentStore(),
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
