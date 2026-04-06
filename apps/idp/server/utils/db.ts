import { createClient } from '@libsql/client/http'
import { drizzle } from 'drizzle-orm/libsql/http'
import * as schema from '../database/schema'
import { ensureTables } from '../database/migrate'

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null
let _migrated = false

export async function useDb() {
  if (!_db) {
    const rc = useRuntimeConfig()
    const client = createClient({
      url: (rc.tursoUrl as string).trim(),
      authToken: (rc.tursoAuthToken as string)?.trim() || undefined,
    })
    _db = drizzle(client, { schema })
  }
  if (!_migrated) {
    await ensureTables(_db)
    _migrated = true
  }
  return _db
}
