import { useRuntimeConfig, useStorage, useEvent } from 'nitropack/runtime'
import type { Storage } from 'unstorage'

export function useIdpStorage(): Storage {
  try {
    const event = useEvent()
    if (event?.context?.openapeStorageKey) {
      return useStorage(event.context.openapeStorageKey)
    }
  }
  catch {}
  const config = useRuntimeConfig().openapeIdp as { storageKey: string }
  return useStorage(config.storageKey)
}
