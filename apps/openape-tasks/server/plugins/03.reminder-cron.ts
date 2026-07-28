import { runReminderJob } from '../jobs/sendReminders'

/**
 * Nitro plugin that ticks the reminder worker every N seconds in-process.
 *
 * Design choice (per plan 01KQ33AQDA64KQEKAHRT455W02 M3): single-process
 * timer instead of separate systemd timer. Pros: zero extra ops, shared
 * DB pool, unified logs. Cons: if we ever scale to multiple replicas
 * we'd duplicate sends — but tasks.openape.ai runs as a single systemd
 * unit on chatty, so not an issue today.
 *
 * Disable via `NUXT_REMINDER_ENABLED=false` (string). Override interval via
 * `NUXT_REMINDER_INTERVAL_MS`. Default 5 minutes.
 *
 * Fires after a 30 s startup delay so the DB plugin (02.database.ts) has
 * already created tables on a fresh deploy. The interval is then
 * setTimeout-chained so a slow tick doesn't pile up overlapping runs.
 */
export default defineNitroPlugin((nitroApp) => {
  if (process.env.OPENAPE_E2E === '1') return
  if (process.env.NUXT_REMINDER_ENABLED === 'false') return

  const intervalMs = Number(process.env.NUXT_REMINDER_INTERVAL_MS) || 5 * 60 * 1000
  const startupDelayMs = 30_000

  let timer: NodeJS.Timeout | null = null
  let stopped = false

  const tick = async (): Promise<void> => {
    if (stopped) return
    try {
      const result = await runReminderJob()
      if (result.picked > 0) {
        console.log(`[reminders] picked=${result.picked} sent=${result.sent} failed=${result.failed} no-recipient=${result.skippedNoRecipient}`)
      }
    }
    catch (err) {
      console.error('[reminders] job threw:', err)
    }
    if (!stopped) {
      timer = setTimeout(tick, intervalMs)
    }
  }

  timer = setTimeout(tick, startupDelayMs)

  nitroApp.hooks.hook('close', () => {
    stopped = true
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  })
})
