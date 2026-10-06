import { defineNitroPlugin } from 'nitropack/runtime'
import { useDatabaseClient } from '../database/drizzle'
import { requireReportsDatabase } from '../database/ready'
import { purgeHtml } from '../utils/html-store'

export default defineNitroPlugin((nitro) => {
  let running = false
  const timer = setInterval(async () => {
    if (running) return
    running = true
    try { await requireReportsDatabase(); await purgeHtml(useDatabaseClient()) }
    catch (error) { console.error('Reports retention cleanup failed', error) }
    finally { running = false }
  }, 60000)
  timer.unref()
  nitro.hooks.hook('close', () => { clearInterval(timer) })
})
