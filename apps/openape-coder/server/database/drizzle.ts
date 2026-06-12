import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { useRuntimeConfig } from 'nitropack/runtime'
import * as schema from './schema'

// Same pattern as chat/org: import useRuntimeConfig from nitropack/runtime
// instead of relying on it being a global auto-import. The store unit tests
// build their own in-memory db and never import this module, so the import is
// safe; relying on the auto-import left useDb() throwing "useRuntimeConfig is
// not defined" in the bundled server (#585, surfaced by the E2E capture).

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null

export function useDb() {
  if (!_db) {
    const config = useRuntimeConfig() as unknown as { tursoUrl: string, tursoAuthToken: string }
    const client = createClient({
      url: config.tursoUrl,
      authToken: config.tursoAuthToken || undefined,
    })
    _db = drizzle(client, { schema })
  }
  return _db
}
