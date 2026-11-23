import { useRuntimeConfig, useStorage, useEvent } from 'nitropack/runtime'

export function useGrantStorage(): ReturnType<typeof useStorage> {
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
