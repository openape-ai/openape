import { resolve } from 'node:path'
import { initializeHtmlPolicyJournal } from '../utils/html-policy-journal'
import { useDatabaseClient } from '../database/drizzle'
import { migrateReports } from '../database/migrate'
import { initializeReportsDatabase } from '../database/ready'

export default defineNitroPlugin(() => {
  initializeReportsDatabase(async () => {
    const client = useDatabaseClient()
    await migrateReports(client)
    const config = useRuntimeConfig()
    const local = String(config.tursoUrl).startsWith('file:') ? `${resolve(String(config.tursoUrl).slice(5))}.policies.json` : ''
    const journal = String(config.htmlPolicyJournalPath || local)
    if (!journal) throw new Error('Configure htmlPolicyJournalPath before serving Reports')
    await initializeHtmlPolicyJournal(client, journal)
  })
})
