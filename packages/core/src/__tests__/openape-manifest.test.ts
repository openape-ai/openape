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
      scopes: {
        'doc:read': { name: 'Read', description: 'Read docs', risk: 'low' },
        'doc:delete': { name: 'Delete', description: 'Delete docs', risk: 'high' },
      },
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

  it('validates scopes as object with required fields per scope', () => {
    expect(validateOpenApeManifest({ ...validManifest(), scopes: 'bad' }).errors).toContain('scopes must be an object if provided')
    expect(validateOpenApeManifest({ ...validManifest(), scopes: { s: 'not-obj' } }).errors.some(e => e.includes('must be an object'))).toBe(true)
    const badScope = validateOpenApeManifest({ ...validManifest(), scopes: { s: { name: '', risk: 'invalid' } } })
    expect(badScope.errors.some(e => e.includes('s.name'))).toBe(true)
    expect(badScope.errors.some(e => e.includes('s.description'))).toBe(true)
    expect(badScope.errors.some(e => e.includes('s.risk'))).toBe(true)
  })

  it('validates policies as object with valid delegation', () => {
    expect(validateOpenApeManifest({ ...validManifest(), policies: 'bad' }).errors).toContain('policies must be an object if provided')
    expect(validateOpenApeManifest({ ...validManifest(), policies: { delegation: 'maybe' } }).errors.some(e => e.includes('delegation'))).toBe(true)
    expect(validateOpenApeManifest({ ...validManifest(), policies: { agent_access: 'open' } }).valid).toBe(true)
  })
})
