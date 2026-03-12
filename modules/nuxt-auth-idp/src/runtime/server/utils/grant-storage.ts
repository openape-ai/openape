import { useRuntimeConfig, useStorage, useEvent } from 'nitropack/runtime'
import type { Storage } from 'unstorage'

export const useGrantStorage = (): Storage => {
  try {
    const event = useEvent()
    if (event?.context?.openapeGrantsStorageKey) {
      return useStorage(event.context.openapeGrantsStorageKey)
    }
  }
  catch {}
  const config = useRuntimeConfig().openapeGrants as { storageKey: string }
  return useStorage(config.storageKey)
}
