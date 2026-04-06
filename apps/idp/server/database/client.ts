// Use HTTP transport for Vercel compatibility (no native binary needed)
import { createClient } from '@libsql/client/http'
import { drizzle } from 'drizzle-orm/libsql/http'
import * as schema from './schema'

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null

export function useDb() {
  if (!_db) {
    const config = useRuntimeConfig()
    const client = createClient({
      url: config.tursoUrl as string,
      authToken: (config.tursoAuthToken as string) || undefined,
    })
    _db = drizzle(client, { schema })
  }
  return _db
}
