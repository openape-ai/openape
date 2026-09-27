import { useDatabaseClient } from '../database/drizzle'
import { migrateReports } from '../database/migrate'

export default defineNitroPlugin(async () => {
  await migrateReports(useDatabaseClient())
})
