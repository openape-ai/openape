import { defineEventHandler } from 'h3'
import { runCheck } from '../../../utils/check'
import { loadOwnMonitor } from '../../../utils/monitor-access'

/** POST /api/monitors/:id/check — re-check a monitor now (owner only). */
export default defineEventHandler(async (event) => {
  const caller = await requireCaller(event)
  const monitor = await loadOwnMonitor(event, caller)
  const result = await runCheck(monitor)
  return {
    status: result.up ? 'up' : 'down',
    code: result.statusCode,
    latency_ms: result.latencyMs,
    error: result.error,
  }
})
