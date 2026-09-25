import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { useRuntimeConfig } from 'nitropack/runtime'
import * as schema from './schema'

let client: ReturnType<typeof createClient> | undefined
let db: ReturnType<typeof drizzle<typeof schema>> | undefined

export function useDatabaseClient() {
  if (!client) {
    const config = useRuntimeConfig()
    client = createClient({ url: config.tursoUrl as string, authToken: (config.tursoAuthToken as string) || '' })
  }
  return client
}

export function useDb() {
  db ??= drizzle(useDatabaseClient(), { schema })
  return db
}
