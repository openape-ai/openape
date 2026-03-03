import { drizzle } from 'drizzle-orm/libsql/http'
import * as schema from '../database/schema'

let _db: ReturnType<typeof drizzle> | null = null

export function useDb() {
  if (!_db) {
    _db = drizzle({
      connection: {
        url: process.env.TURSO_URL!.trim(),
        authToken: process.env.TURSO_AUTH_TOKEN?.trim(),
      },
      schema,
    })
  }
  return _db
}
