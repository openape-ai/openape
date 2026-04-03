import { describe, expect, it } from 'vitest'
import { validateOpenApeManifest } from '../validation/openape-manifest.js'

function validManifest() {
  return {
    version: '1.0',
    service: {
      name: 'Test Service',
      url: 'https://example.com',
    },
  }
}

describe('validateOpenApeManifest', () => {
  it('accepts a minimal valid manifest', () => {
    const result = validateOpenApeManifest(validManifest())
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.manifest?.version).toBe('1.0')
    expect(result.manifest?.service.name).toBe('Test Service')
  })

  it('accepts a full manifest with all optional fields', () => {
    const result = validateOpenApeManifest({
      ...validManifest(),
      auth: {
        ddisa_domain: 'example.com',
        supported_methods: ['ddisa', 'oidc'],
      },
      scopes: {
        'doc:read': {
          name: 'Read documents',
          description: 'Read all documents',
          risk: 'low',
          category: 'documents',
        },
        'doc:delete': {
          name: 'Delete documents',
          description: 'Permanently delete documents',
          risk: 'high',
          category: 'documents',
          parameters: {
            id: { type: 'string', description: 'Document ID' },
          },
        },
      },
      categories: {
        documents: { name: 'Documents', icon: '📄' },
      },
      policies: {
        agent_access: 'allowlist-user',
        delegation: 'allowed',
        max_delegation_duration: '30d',
        require_grant_for_risk: {
          low: null,
          high: 'once',
          critical: 'once',
        },
      },
      rate_limits: {
        'doc:delete': { max_per_hour: 10 },
      },
      endpoints: {
        api_base: 'https://example.com/api',
      },
    })
    expect(result.valid).toBe(true)
    expect(result.manifest?.scopes?.['doc:read'].risk).toBe('low')
    expect(result.manifest?.policies?.delegation).toBe('allowed')
  })

  it('rejects non-object', () => {
    expect(validateOpenApeManifest(null).valid).toBe(false)
    expect(validateOpenApeManifest('string').valid).toBe(false)
    expect(validateOpenApeManifest(42).valid).toBe(false)
  })

  it('requires version', () => {
    const { version: _, ...noVersion } = validManifest()
    const result = validateOpenApeManifest(noVersion)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('version is required and must be a non-empty string')
  })

  it('requires service.name', () => {
    const result = validateOpenApeManifest({
      version: '1.0',
      service: { url: 'https://example.com' },
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('service.name'))).toBe(true)
  })

  it('requires service.url', () => {
    const result = validateOpenApeManifest({
      version: '1.0',
      service: { name: 'Test' },
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('service.url'))).toBe(true)
  })

  it('validates auth.supported_methods', () => {
    const result = validateOpenApeManifest({
      ...validManifest(),
      auth: { supported_methods: ['invalid'] },
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('invalid method'))).toBe(true)
  })

  it('rejects auth without supported_methods', () => {
    const result = validateOpenApeManifest({
      ...validManifest(),
      auth: {},
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('supported_methods'))).toBe(true)
  })

  it('validates scope fields', () => {
    const result = validateOpenApeManifest({
      ...validManifest(),
      scopes: {
        'bad:scope': { name: '', risk: 'invalid' },
      },
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('bad:scope.name'))).toBe(true)
    expect(result.errors.some(e => e.includes('bad:scope.description'))).toBe(true)
    expect(result.errors.some(e => e.includes('bad:scope.risk'))).toBe(true)
  })

  it('validates policies.delegation', () => {
    const result = validateOpenApeManifest({
      ...validManifest(),
      policies: { delegation: 'maybe' },
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('delegation'))).toBe(true)
  })

  it('ignores unknown fields (forward-compatible)', () => {
    const result = validateOpenApeManifest({
      ...validManifest(),
      future_field: 'something',
    })
    expect(result.valid).toBe(true)
  })

  it('rejects scope with non-object value', () => {
    const result = validateOpenApeManifest({
      ...validManifest(),
      scopes: {
        'bad:scope': 'not-an-object',
      },
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('bad:scope') && e.includes('must be an object'))).toBe(true)
  })

  it('rejects scope with null value', () => {
    const result = validateOpenApeManifest({
      ...validManifest(),
      scopes: {
        'null:scope': null,
      },
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('null:scope') && e.includes('must be an object'))).toBe(true)
  })

  it('rejects policies with invalid delegation value', () => {
    const result = validateOpenApeManifest({
      ...validManifest(),
      policies: { delegation: 123 },
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('delegation'))).toBe(true)
  })

  it('rejects auth with non-object value', () => {
    const result = validateOpenApeManifest({
      ...validManifest(),
      auth: 'not-an-object',
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('auth must be an object'))).toBe(true)
  })

  it('rejects auth with null value', () => {
    const result = validateOpenApeManifest({
      ...validManifest(),
      auth: null,
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('auth must be an object'))).toBe(true)
  })

  it('rejects scopes with non-object value (top-level)', () => {
    const result = validateOpenApeManifest({
      ...validManifest(),
      scopes: 'not-an-object',
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('scopes must be an object'))).toBe(true)
  })

  it('rejects scopes with null value (top-level)', () => {
    const result = validateOpenApeManifest({
      ...validManifest(),
      scopes: null,
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('scopes must be an object'))).toBe(true)
  })

  it('rejects policies with non-object value', () => {
    const result = validateOpenApeManifest({
      ...validManifest(),
      policies: 'not-an-object',
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('policies must be an object'))).toBe(true)
  })

  it('rejects policies with null value', () => {
    const result = validateOpenApeManifest({
      ...validManifest(),
      policies: null,
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('policies must be an object'))).toBe(true)
  })

  it('accepts policies without delegation field', () => {
    const result = validateOpenApeManifest({
      ...validManifest(),
      policies: { agent_access: 'open' },
    })
    expect(result.valid).toBe(true)
  })

  it('rejects service with non-object value', () => {
    const result = validateOpenApeManifest({
      version: '1.0',
      service: 'not-an-object',
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('service is required and must be an object'))).toBe(true)
  })

  it('rejects empty auth.supported_methods array', () => {
    const result = validateOpenApeManifest({
      ...validManifest(),
      auth: { supported_methods: [] },
    })
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('auth.supported_methods is required'))).toBe(true)
  })
})
