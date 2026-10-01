import { describe, expect, it } from 'vitest'
import { parsePayloadSchema, validateNetworkPayload } from '../../src/contracts/network-payload'

function schema() {
  return parsePayloadSchema({
    type: 'object', additionalProperties: false, required: ['status'],
    properties: {
      status: { type: 'string', enum: ['ready', 'waiting'], maxLength: 7 },
      count: { type: 'integer' }, score: { type: 'number' },
      enabled: { type: 'boolean' }, empty: { type: 'null' },
      labels: { type: 'array', items: { type: 'string', maxLength: 4 }, maxItems: 2 },
    },
  })
}

describe('network metadata contracts', () => {
  it('accepts declared scalars and bounded arrays without coercion', () => {
    const input = { status: 'ready', count: 3, score: 0.5, enabled: false, empty: null, labels: ['done'] }
    const accepted = validateNetworkPayload(input, schema())
    expect(accepted).toEqual(input)
    expect(accepted).not.toBe(input)
    expect(accepted.labels).not.toBe(input.labels)
  })

  it.each([
    {}, { status: 'unknown' }, { status: 'ready', extra: 1 },
    { status: 'ready', count: '3' }, { status: 'ready', count: 1.5 },
    { status: 'ready', score: Infinity }, { status: 'ready', score: Number.NaN },
    { status: 'ready', enabled: 0 }, { status: 'ready', empty: undefined },
    { status: 'ready', labels: ['a', 'b', 'c'] },
    { status: 'ready', labels: ['large'] }, { status: 'ready', labels: [{}] },
  ])('rejects mismatched metadata %j', (input) => {
    expect(() => validateNetworkPayload(input, schema())).toThrow()
  })

  it.each([
    { type: 'object', properties: {}, required: [], additionalProperties: true },
    { ...schema(), $ref: 'https://example.invalid/schema' },
    { ...schema(), required: ['missing'] }, { ...schema(), required: ['status', 'status'] },
    { ...schema(), properties: { value: { type: 'object', properties: {} } }, required: [] },
    { ...schema(), properties: { value: { type: 'string', pattern: '.*' } }, required: [] },
    { ...schema(), properties: { value: { type: 'number', maxLength: 2 } }, required: [] },
    { ...schema(), properties: { value: { type: 'string', enum: ['a', 'a'] } }, required: [] },
    { ...schema(), properties: { value: { type: 'array', items: { type: 'array' }, maxItems: 2 } }, required: [] },
    { ...schema(), properties: { value: { type: 'array', items: { type: 'null' } } }, required: [] },
    { ...schema(), properties: { value: { type: 'array', items: { type: 'null' }, maxItems: 33 } }, required: [] },
  ])('rejects unsupported schema %j', (input) => {
    expect(() => parsePayloadSchema(input)).toThrow()
  })

  it('measures metadata in UTF-8 bytes and enforces the exact boundary', () => {
    const spec = parsePayloadSchema({ type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false })
    expect(validateNetworkPayload({ text: 'a'.repeat(1013) }, spec).text).toHaveLength(1013)
    expect(() => validateNetworkPayload({ text: 'a'.repeat(1014) }, spec)).toThrow('1,024 bytes')
    expect(() => validateNetworkPayload({ text: '🐵'.repeat(254) }, spec)).toThrow('1,024 bytes')
  })

  it('uses own field names even for names present on Object.prototype', () => {
    const spec = parsePayloadSchema(JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}},"required":["__proto__"],"additionalProperties":false}'))
    expect(validateNetworkPayload(JSON.parse('{"__proto__":"safe"}'), spec)).toEqual(JSON.parse('{"__proto__":"safe"}'))
    expect(() => validateNetworkPayload({ constructor: 'unexpected' }, spec)).toThrow()
  })

  it('rejects more than 32 fields', () => {
    expect(() => parsePayloadSchema({ type: 'object', properties: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`f${index}`, { type: 'null' }])), required: [], additionalProperties: false })).toThrow('32 fields')
  })

  it('canonicalizes equivalent schemas and producer field order', () => {
    const left = parsePayloadSchema({ type: 'object', properties: { b: { type: 'string', enum: ['z', 'a'] }, a: { type: 'null' } }, required: ['b', 'a'], additionalProperties: false })
    const right = parsePayloadSchema({ type: 'object', properties: { a: { type: 'null' }, b: { type: 'string', enum: ['a', 'z'] } }, required: ['a', 'b'], additionalProperties: false })
    expect(JSON.stringify(left)).toBe(JSON.stringify(right))
    expect(JSON.stringify(validateNetworkPayload({ b: 'a', a: null }, left))).toBe(JSON.stringify(validateNetworkPayload({ a: null, b: 'a' }, right)))
  })

  it('rejects accessors and array serializers without executing them', () => {
    let reads = 0
    const input = Object.defineProperty({}, 'status', { enumerable: true, get() { reads++; return 'ready' } })
    expect(() => validateNetworkPayload(input, schema())).toThrow('plain data')
    const labels = ['done']
    Object.defineProperty(labels, 'toJSON', { value() { reads++; return ['wrong'] } })
    expect(() => validateNetworkPayload({ status: 'ready', labels }, schema())).toThrow('plain data')
    expect(reads).toBe(0)
  })

  it('rejects oversized strings even without a declared maximum', () => {
    const spec = parsePayloadSchema({ type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false })
    expect(() => validateNetworkPayload({ text: 'a'.repeat(1025) }, spec)).toThrow('scalar schema')
    expect(() => parsePayloadSchema({ ...spec, properties: { text: { type: 'string', enum: ['a'.repeat(1025)] } } })).toThrow('scalar enum')
  })
})
