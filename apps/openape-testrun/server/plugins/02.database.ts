import { resolve } from 'node:path'
import { initializeHtmlPolicyJournal, persistAuthoritativePolicyJournal } from '../utils/html-policy-journal'
import { useDatabaseClient } from '../database/drizzle'
import { migrateReports } from '../database/migrate'
import { initializeReportsDatabase, setRecoveryReadiness } from '../database/ready'
import { assertRecoveryConfigured, enableRecovery, recoveryFailure } from '../recovery/client'
import { readRecoveryConfig, s3RecoveryStore } from '../recovery/storage'

export default defineNitroPlugin(() => {
  initializeReportsDatabase(async () => {
    const client = useDatabaseClient()
    await migrateReports(client)
    const config = useRuntimeConfig()
    const local = String(config.tursoUrl).startsWith('file:') ? `${resolve(String(config.tursoUrl).slice(5))}.policies.json` : ''
    const journal = String(config.htmlPolicyJournalPath || local)
    if (!journal) throw new Error('Configure htmlPolicyJournalPath before serving Reports')
    const recoveryPath = String(config.reportsRecoveryConfigPath || '')
    if (recoveryPath) {
      const recovery = await readRecoveryConfig(recoveryPath)
      await enableRecovery(client, { store: s3RecoveryStore(recovery), key: Buffer.from(recovery.encryptionKey, 'base64') })
      setRecoveryReadiness(() => recoveryFailure(client))
      await persistAuthoritativePolicyJournal(client, journal)
    }
    else {
      await assertRecoveryConfigured(client)
    }
    await initializeHtmlPolicyJournal(client, journal)
  })
})
