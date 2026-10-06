import { useDatabaseClient } from '../database/drizzle'
import { migrateDatabase } from '../database/migrations'

export default defineNitroPlugin(async () => {
  await migrateDatabase(useDatabaseClient())
})
