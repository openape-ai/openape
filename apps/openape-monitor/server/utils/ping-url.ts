import type { H3Event } from 'h3'
import { getRequestURL } from 'h3'
import { useRuntimeConfig } from 'nitropack/runtime'

/**
 * Absolute ping URL for a heartbeat token. Prefers the configured public URL
 * (production sets it) and falls back to the request origin, so the URL a
 * developer copies out of `pnpm dev` points at their own server rather than
 * at production.
 */
export function pingUrlFor(event: H3Event, token: string): string {
  const { publicUrl } = useRuntimeConfig()
  const base = ((publicUrl as string) || getRequestURL(event).origin).replace(/\/$/, '')
  return `${base}/api/ping/${token}`
}
