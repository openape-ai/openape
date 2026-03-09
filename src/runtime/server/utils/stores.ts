import { useRuntimeConfig, useEvent } from 'nitropack/runtime'
import { createAgentStore } from './agent-store'
import { createChallengeStore } from './challenge-store'
import { createCodeStore } from './code-store'
import { createCredentialStore } from './credential-store'
import { createJtiStore } from './jti-store'
import { createKeyStore } from './key-store'
import { createRegistrationUrlStore } from './registration-url-store'
import { createUserStore } from './user-store'

let _stores: ReturnType<typeof initStores> | null = null

function initStores() {
  return {
    userStore: createUserStore(),
    codeStore: createCodeStore(),
    keyStore: createKeyStore(),
    agentStore: createAgentStore(),
    credentialStore: createCredentialStore(),
    challengeStore: createChallengeStore(),
    registrationUrlStore: createRegistrationUrlStore(),
    jtiStore: createJtiStore(),
  }
}

function getStores() {
  if (!_stores) {
    _stores = initStores()
  }
  return _stores
}

export function useIdpStores() {
  try {
    const event = useEvent()
    if (event?.context?.openapeStorageKey) {
      if (!event.context._idpStores) {
        event.context._idpStores = initStores()
      }
      return event.context._idpStores as ReturnType<typeof initStores>
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
