import { useEvent } from 'nitropack/runtime'
import { createGrantStore } from './grant-store'
import { createGrantChallengeStore } from './grant-challenge-store'

let _stores: ReturnType<typeof initStores> | null = null

function initStores() {
  return {
    grantStore: createGrantStore(),
    challengeStore: createGrantChallengeStore(),
  }
}

function getStores() {
  if (!_stores) {
    _stores = initStores()
  }
  return _stores
}

export function useGrantStores() {
  try {
    const event = useEvent()
    if (event?.context?.openapeGrantsStorageKey) {
      if (!event.context._grantStores) {
        event.context._grantStores = initStores()
      }
      return event.context._grantStores as ReturnType<typeof initStores>
    }
  }
  catch {}
  return getStores()
}
