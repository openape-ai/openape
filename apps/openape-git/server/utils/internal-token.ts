import { randomBytes, timingSafeEqual } from 'node:crypto'

// Loopback credential between this process and the receive hooks it spawns.
// Minted per process and never persisted: a hook run by anything but this
// server cannot post push events.

let token: string | null = null

export function internalToken(): string {
  if (!token) token = randomBytes(32).toString('hex')
  return token
}

export function isInternalToken(given: string | undefined): boolean {
  if (!given) return false
  const expected = Buffer.from(internalToken())
  const buffer = Buffer.from(given)
  return expected.length === buffer.length && timingSafeEqual(expected, buffer)
}

/** Loopback URL of the push-event endpoint, handed to the hook via env. */
export function pushEventUrl(): string {
  const port = process.env.NITRO_PORT || process.env.PORT || '3026'
  return `http://localhost:${port}/api/internal/push-event`
}
