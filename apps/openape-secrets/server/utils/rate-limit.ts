import type { H3Event } from 'h3'
import { setResponseHeader } from 'h3'
import { createProblemError } from './problem'

const windows = new Map<string, { count: number, resetAt: number }>()

/**
 * Fixed-window limit per key, kept in this process. The service runs as one
 * process; a restart resets the windows, which errs on the side of letting the
 * owner's own agents through.
 */
export function rateLimit(event: H3Event, key: string, limit = 60, windowSec = 60) {
  const now = Date.now()
  const window = windows.get(key)
  if (!window || window.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowSec * 1000 })
    return
  }
  window.count++
  if (window.count > limit) {
    setResponseHeader(event, 'retry-after', Math.ceil((window.resetAt - now) / 1000))
    throw createProblemError({ status: 429, title: 'Too many requests', detail: 'Wait a moment and try again.' })
  }
}
