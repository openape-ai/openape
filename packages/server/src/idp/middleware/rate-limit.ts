import { defineEventHandler, getRequestIP, getRequestURL } from 'h3'
import { createProblemError } from '../utils/problem.js'

interface RateLimitEntry {
  count: number
  resetAt: number
}

export interface RateLimitConfig {
  /** Max requests per window (default: 10) */
  maxRequests?: number
  /** Window duration in ms (default: 60000 = 1 minute) */
  windowMs?: number
  /** Paths to rate-limit (default: auth endpoints) */
  paths?: string[]
}

export function createRateLimitMiddleware(config: RateLimitConfig = {}) {
  const maxRequests = config.maxRequests ?? 10
  const windowMs = config.windowMs ?? 60_000
  const paths = config.paths ?? [
    '/api/auth/challenge',
    '/api/auth/authenticate',
    '/api/auth/enroll',
    '/api/session/login',
    '/api/agent/challenge',
    '/api/agent/authenticate',
  ]

  const store = new Map<string, RateLimitEntry>()

  // Cleanup expired entries periodically
  const cleanup = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) store.delete(key)
    }
  }, windowMs)
  cleanup.unref()

  return defineEventHandler((event) => {
    const path = getRequestURL(event).pathname
    if (!paths.includes(path)) return

    const ip = getRequestIP(event, { xForwardedFor: true }) || 'unknown'
    const key = `${ip}:${path}`
    const now = Date.now()

    let entry = store.get(key)
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs }
      store.set(key, entry)
    }

    entry.count++

    event.node.res.setHeader('X-RateLimit-Limit', maxRequests.toString())
    event.node.res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - entry.count).toString())
    event.node.res.setHeader('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000).toString())

    if (entry.count > maxRequests) {
      throw createProblemError({
        status: 429,
        title: 'Too many requests',
        detail: `Rate limit exceeded. Try again in ${Math.ceil((entry.resetAt - now) / 1000)} seconds.`,
      })
    }
  })
}
