import type { H3Event } from 'h3'
import { useEvent } from 'nitropack/runtime'
import { createGrantStore } from './grant-store'
import type { ExtendedGrantStore } from './grant-store'
import { createGrantChallengeStore } from './grant-challenge-store'
import type { ChallengeStore } from './grant-challenge-store'
import { getStoreFactory } from './store-registry'

interface GrantStores {
  grantStore: ExtendedGrantStore
  challengeStore: ChallengeStore
}

let _stores: GrantStores | null = null

function initDefaultStores(): GrantStores {
  return {
    grantStore: createGrantStore(),
    challengeStore: createGrantChallengeStore(),
  }
}

function initStoresWithRegistry(event: H3Event): GrantStores {
  const grantFactory = getStoreFactory<ExtendedGrantStore>('grantStore')
  const challengeFactory = getStoreFactory<ChallengeStore>('grantChallengeStore')

  return {
    grantStore: grantFactory ? grantFactory(event) : createGrantStore(),
    challengeStore: challengeFactory ? challengeFactory(event) : createGrantChallengeStore(),
  }
}

function getStores(): GrantStores {
  if (!_stores) {
    _stores = initDefaultStores()
  }
  return _stores
}

export function useGrantStores(): GrantStores {
  try {
    const event = useEvent()
    if (event?.context?.openapeGrantsStorageKey) {
      if (!event.context._grantStores) {
        event.context._grantStores = initStoresWithRegistry(event)
      }
      return event.context._grantStores as GrantStores
    }
    // Even without tenant context, check registry if event is available
    if (event) {
      if (!event.context._grantStores) {
        event.context._grantStores = initStoresWithRegistry(event)
      }
      return event.context._grantStores as GrantStores
    }
  }
  catch {}
  return getStores()
}
