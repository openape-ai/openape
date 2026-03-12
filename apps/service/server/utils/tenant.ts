import type { H3Event } from 'h3'
import { createError } from 'h3'

export function getRequestTenant(event: H3Event): string | null {
  return event.context.tenantSlug || null
}

export function requireTenant(event: H3Event): string {
  const slug = getRequestTenant(event)
  if (!slug) {
    throw createError({ statusCode: 400, statusMessage: 'Tenant context required' })
  }
  return slug
}
