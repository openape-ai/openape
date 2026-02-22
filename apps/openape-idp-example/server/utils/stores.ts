import { createAgentStore } from './agent-store'
import { createChallengeStore } from './challenge-store'
import { createCodeStore } from './code-store'
import { createGrantStore } from './grant-store'
import { createKeyStore } from './key-store'
import { createUserStore } from './user-store'

let _stores: ReturnType<typeof initStores> | null = null

function initStores() {
  return {
    userStore: createUserStore(),
    codeStore: createCodeStore(),
    keyStore: createKeyStore(),
    grantStore: createGrantStore(),
    agentStore: createAgentStore(),
    challengeStore: createChallengeStore(),
  }
}

function getStores() {
  if (!_stores) {
    _stores = initStores()
  }
  return _stores
}

export const useStores = getStores

export const IDP_ISSUER = process.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3000'
