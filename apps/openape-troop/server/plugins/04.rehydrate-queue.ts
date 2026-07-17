import { loadAndPrunePending } from '../utils/cockpit/task-store'
import { restoreTask } from '../utils/cockpit/queue'

// On boot, re-offer the tasks that were in-flight when troop last stopped, so a
// restart (every deploy) doesn't silently drop a proactive fire. Runs after
// 02.database (tables exist); the worker re-claims the restored tasks on its next
// poll. Rows older than the queue TTL are pruned (the worker never ran them).
const MAX_AGE_MS = 30 * 60_000

export default defineNitroPlugin(async () => {
  if (process.env.OPENAPE_E2E === '1') return
  try {
    const rows = await loadAndPrunePending(MAX_AGE_MS, Date.now())
    for (const t of rows) restoreTask(t)
    if (rows.length) console.log(`[rehydrate-queue] restored ${rows.length} in-flight task(s) after restart`)
  }
  catch (err) {
    console.error('[rehydrate-queue]', err)
  }
})
