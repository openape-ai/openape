import { randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'
import { createError, getHeader, getRequestURL } from 'h3'

export function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url')
}

export function validateCsrfToken(sessionToken: string | undefined, requestToken: string | undefined): void {
  if (!sessionToken || !requestToken || sessionToken !== requestToken) {
    throw createError({ statusCode: 403, statusMessage: 'Invalid CSRF token' })
  }
}

export function validateOrigin(event: H3Event): void {
  const origin = getHeader(event, 'origin')
  const referer = getHeader(event, 'referer')
  const requestUrl = getRequestURL(event)
  const expectedOrigin = requestUrl.origin

  const source = origin || (referer ? new URL(referer).origin : null)

  if (!source || source !== expectedOrigin) {
    throw createError({ statusCode: 403, statusMessage: 'Invalid origin' })
  }
}

export function enforceJsonContentType(event: H3Event): void {
  const contentType = getHeader(event, 'content-type')
  if (!contentType?.includes('application/json')) {
    throw createError({ statusCode: 415, statusMessage: 'Content-Type must be application/json' })
  }
}
