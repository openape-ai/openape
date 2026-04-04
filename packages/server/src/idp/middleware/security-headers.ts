import { defineEventHandler, setResponseHeaders } from 'h3'

export function createSecurityHeadersMiddleware() {
  return defineEventHandler((event) => {
    setResponseHeaders(event, {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': 'frame-ancestors \'none\'',
      'X-XSS-Protection': '0',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cache-Control': 'no-store',
    })
  })
}
