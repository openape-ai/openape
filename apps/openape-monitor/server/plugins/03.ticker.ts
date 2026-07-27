import { runDueChecks } from '../utils/check'

/**
 * In-process ticker: every 60s, check all monitors whose interval has elapsed.
 * ponytail: single in-process setInterval, fine for one node-server instance.
 * If we ever run >1 replica, move this to an external scheduler (or a DB lease)
 * so each due check runs once, not once per replica.
 */
const TICK_MS = 60_000

export default defineNitroPlugin((nitro) => {
  let running = false
  const tick = async () => {
    if (running) return // skip if the previous tick is still going
    running = true
    try {
      const n = await runDueChecks()
      if (n > 0) console.log(`[ticker] checked ${n} monitor(s)`)
    }
    catch (err) {
      console.error('[ticker] tick failed:', err)
    }
    finally {
      running = false
    }
  }

  const handle = setInterval(tick, TICK_MS)
  // Don't keep the event loop alive just for the ticker.
  if (typeof handle.unref === 'function') handle.unref()
  nitro.hooks.hook('close', () => clearInterval(handle))
})
