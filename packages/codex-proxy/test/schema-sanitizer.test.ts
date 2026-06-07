import { describe, expect, it } from 'vitest'
import { sanitizeToolParameters } from '../src/schema-sanitizer'

describe('sanitizeToolParameters', () => {
  it('strips top-level combinators the Codex backend rejects (allOf/anyOf/oneOf/enum/not)', () => {
    const params = {
      type: 'object',
      properties: { a: { type: 'string' } },
      // conditional required-fields hint MCP tools emit at the top level
      allOf: [{ if: { properties: { a: { const: 'x' } } }, then: { required: ['a'] } }],
    }
    const out = sanitizeToolParameters(params)
    expect(out).not.toHaveProperty('allOf')
    expect(out.type).toBe('object')
    expect(out.properties).toEqual({ a: { type: 'string' } })
  })

  it('preserves combinators nested inside a property (only the top level is strict)', () => {
    const params = {
      type: 'object',
      properties: { a: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
    }
    const out = sanitizeToolParameters(params)
    expect((out.properties as { a: { anyOf?: unknown[] } }).a.anyOf).toHaveLength(2)
  })

  it('collapses a nullable anyOf union to the non-null branch + nullable hint', () => {
    const params = {
      type: 'object',
      properties: { a: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'x' } },
    }
    const out = sanitizeToolParameters(params)
    expect((out.properties as Record<string, unknown>).a).toEqual({ type: 'string', description: 'x', nullable: true })
  })

  it('collapses array-form nullable type ["X","null"] to X + nullable hint', () => {
    const params = { type: 'object', properties: { a: { type: ['string', 'null'] } } }
    const out = sanitizeToolParameters(params)
    expect((out.properties as Record<string, unknown>).a).toEqual({ type: 'string', nullable: true })
  })

  it('recurses into array items', () => {
    const params = { type: 'object', properties: { a: { type: 'array', items: { type: ['string', 'null'] } } } }
    const out = sanitizeToolParameters(params)
    expect((out.properties as { a: { items?: unknown } }).a.items).toEqual({ type: 'string', nullable: true })
  })

  it('does not mutate the input', () => {
    const params = { type: 'object', anyOf: [{ x: 1 }], properties: { a: { type: ['string', 'null'] } } }
    const snapshot = JSON.parse(JSON.stringify(params))
    sanitizeToolParameters(params)
    expect(params).toEqual(snapshot)
  })

  it('handles an empty schema', () => {
    expect(sanitizeToolParameters({})).toEqual({})
  })
})
