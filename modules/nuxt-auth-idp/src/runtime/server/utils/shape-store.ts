import type { ShapeStore } from '@openape/grants'
import { createInMemoryShapeStore } from '@openape/grants'
import { useEvent } from 'nitropack/runtime'
import { getStoreFactory } from './store-registry'

/**
 * Module-level fallback — used when the consuming app has not registered a
 * production store via `defineShapeStore()`. Empty by default; callers can
 * seed it for tests via `createInMemoryShapeStore(...)` + `defineShapeStore`.
 */
let _defaultStore: ShapeStore | null = null

function getDefaultShapeStore(): ShapeStore {
  if (!_defaultStore) {
    _defaultStore = createInMemoryShapeStore()
  }
  return _defaultStore
}

/**
 * Return the `ShapeStore` for the current request. Follows the same pattern
 * as `useIdpStores()`/`useGrantStores()`: if a factory is registered via
 * `defineShapeStore(factory)` (in openape-free-idp: a Drizzle-backed impl),
 * use that per-event. Otherwise fall back to a shared in-memory store.
 */
export function useShapeStore(): ShapeStore {
  try {
    const event = useEvent()
    if (event) {
      const cached = (event.context as Record<string, unknown>)._shapeStore as ShapeStore | undefined
      if (cached) return cached
      const factory = getStoreFactory<ShapeStore>('shapeStore')
      const store = factory ? factory(event) : getDefaultShapeStore()
      ;(event.context as Record<string, unknown>)._shapeStore = store
      return store
    }
  }
  catch {
    // Fall through to module-level default when called outside a request
    // context (e.g. from tests that instantiate handlers directly).
  }
  return getDefaultShapeStore()
}
