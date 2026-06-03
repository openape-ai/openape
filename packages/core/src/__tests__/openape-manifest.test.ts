import { describe, expect, it } from 'vitest'
import { validateOpenApeManifest } from '../validation/openape-manifest.js'

function validManifest() {
  return {
    version: '1.0',
    service: { name: 'Test Service', url: 'https://example.com' },
  }
}

describe('validateOpenApeManifest', () => {
  it('accepts a minimal valid manifest', () => {
    const result = validateOpenApeManifest(validManifest())
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('accepts a full manifest with all optional fields', () => {
    const result = validateOpenApeManifest({
      ...validManifest(),
      auth: { supported_methods: ['ddisa', 'oidc'] },
      scopes: [
        { id: 'doc:read', description: 'Read docs', risk: 'low', grants: ['GET /api/docs'] },
        { id: 'doc:delete', description: 'Delete docs', risk: 'high' },
      ],
      policies: { delegation: 'allowed' },
      future_field: 'forward-compatible',
    })
    expect(result.valid).toBe(true)
  })

  it('rejects non-object input', () => {
    for (const input of [null, 'string', 42]) {
      expect(validateOpenApeManifest(input).valid).toBe(false)
    }
  })

  it('requires version, service.name, and service.url', () => {
    const noVersion = validateOpenApeManifest({ service: { name: 'X', url: 'X' } })
    expect(noVersion.errors.some(e => e.includes('version'))).toBe(true)

    const noName = validateOpenApeManifest({ version: '1', service: { url: 'X' } })
    expect(noName.errors.some(e => e.includes('service.name'))).toBe(true)

    const noUrl = validateOpenApeManifest({ version: '1', service: { name: 'X' } })
    expect(noUrl.errors.some(e => e.includes('service.url'))).toBe(true)

    const noService = validateOpenApeManifest({ version: '1', service: 'not-obj' })
    expect(noService.errors.some(e => e.includes('service is required'))).toBe(true)
  })

  it('validates auth as object with valid supported_methods', () => {
    expect(validateOpenApeManifest({ ...validManifest(), auth: 'bad' }).errors).toContain('auth must be an object if provided')
    expect(validateOpenApeManifest({ ...validManifest(), auth: null }).errors).toContain('auth must be an object if provided')
    expect(validateOpenApeManifest({ ...validManifest(), auth: {} }).errors.some(e => e.includes('supported_methods'))).toBe(true)
    expect(validateOpenApeManifest({ ...validManifest(), auth: { supported_methods: [] } }).errors.some(e => e.includes('supported_methods'))).toBe(true)
    expect(validateOpenApeManifest({ ...validManifest(), auth: { supported_methods: ['invalid'] } }).errors.some(e => e.includes('invalid method'))).toBe(true)
  })

  it('validates scopes as an array with required fields per entry', () => {
    // non-array → error
    expect(validateOpenApeManifest({ ...validManifest(), scopes: 'bad' }).errors).toContain('scopes must be an array if provided')
    expect(validateOpenApeManifest({ ...validManifest(), scopes: {} }).errors).toContain('scopes must be an array if provided')
    // entry that is not an object → error
    expect(validateOpenApeManifest({ ...validManifest(), scopes: ['not-obj'] }).errors.some(e => e.includes('must be an object'))).toBe(true)
    // missing id → error
    const missingId = validateOpenApeManifest({ ...validManifest(), scopes: [{ description: 'desc' }] })
    expect(missingId.errors.some(e => e.includes('scopes[0].id is required'))).toBe(true)
    // missing description → error
    const missingDesc = validateOpenApeManifest({ ...validManifest(), scopes: [{ id: 'doc:read' }] })
    expect(missingDesc.errors.some(e => e.includes('scopes[0].description is required'))).toBe(true)
    // bad risk → error
    const badRisk = validateOpenApeManifest({ ...validManifest(), scopes: [{ id: 'doc:read', description: 'desc', risk: 'invalid' }] })
    expect(badRisk.errors.some(e => e.includes('scopes[0].risk'))).toBe(true)
    // bad grants (not string[]) → error
    const badGrants = validateOpenApeManifest({ ...validManifest(), scopes: [{ id: 'doc:read', description: 'desc', grants: [42] }] })
    expect(badGrants.errors.some(e => e.includes('scopes[0].grants'))).toBe(true)
    // valid entry with risk + grants → passes
    const valid = validateOpenApeManifest({ ...validManifest(), scopes: [{ id: 'doc:read', description: 'desc', risk: 'low', grants: ['GET /api/docs'] }] })
    expect(valid.valid).toBe(true)
  })

  it('validates policies as object with valid delegation', () => {
    expect(validateOpenApeManifest({ ...validManifest(), policies: 'bad' }).errors).toContain('policies must be an object if provided')
    expect(validateOpenApeManifest({ ...validManifest(), policies: { delegation: 'maybe' } }).errors.some(e => e.includes('delegation'))).toBe(true)
    expect(validateOpenApeManifest({ ...validManifest(), policies: { agent_access: 'open' } }).valid).toBe(true)
  })
})
