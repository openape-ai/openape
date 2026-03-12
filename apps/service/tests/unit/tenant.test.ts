import { describe, expect, it } from 'vitest'
import { getRequestTenant, requireTenant } from '../../server/utils/tenant'

describe('tenant helpers', () => {
  it('returns tenant slug from request context', () => {
    const event = { context: { tenantSlug: 'acme' } } as any
    expect(getRequestTenant(event)).toBe('acme')
  })

  it('throws when tenant context is missing', () => {
    const event = { context: {} } as any
    expect(() => requireTenant(event)).toThrow('Tenant context required')
  })
})
