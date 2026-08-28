// Fixed-window per-key rate limiter for the git transport routes (security
// checklist; deferred from M1). In-memory on purpose: one app process per VM.
// ponytail: fixed window, sliding window if bursts at the boundary ever matter.

export interface RateLimiter {
  /** true = allowed, false = over the limit for this window. */
  hit: (key: string) => boolean
}

export function createRateLimiter(limit: number, windowSec: number, now: () => number = Date.now): RateLimiter {
  let windowStart = now()
  let counts = new Map<string, number>()

  return {
    hit(key: string): boolean {
      const at = now()
      if (at - windowStart >= windowSec * 1000) {
        windowStart = at
        counts = new Map()
      }
      const count = (counts.get(key) ?? 0) + 1
      counts.set(key, count)
      return count <= limit
    },
  }
}
