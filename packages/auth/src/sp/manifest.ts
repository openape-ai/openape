import type { SPClientMetadata } from '@openape/core'

/**
 * Generate an SP Client Metadata object (RFC 7591).
 */
export function createClientMetadata(config: SPClientMetadata): SPClientMetadata {
  return { ...config }
}

/**
 * Create a Response object serving the SP Client Metadata as JSON.
 */
export function serveClientMetadata(config: SPClientMetadata): Response {
  return new Response(JSON.stringify(config, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}
