import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineEventHandler, setResponseStatus } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'
import { evaluateBackup } from '../../utils/backup-status'

/**
 * GET /api/health/backup — is the off-site backup current? 200 when the last
 * run succeeded within the age limit, 503 otherwise. Unauthenticated like
 * /api/health so monitor.openape.ai can poll it; it exposes only the age and
 * snapshot id of the backup, never repository content.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const path = resolve(config.gitDataDir as string, 'backup-status.json')
  const raw = await readFile(path, 'utf8').catch(() => null)

  const { healthy, ...details } = evaluateBackup(raw, Date.now(), Number(config.backupMaxAgeSec))
  if (!healthy)
    setResponseStatus(event, 503)

  return { ok: healthy, ...details }
})
