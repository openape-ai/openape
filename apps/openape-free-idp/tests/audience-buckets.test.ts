import { describe, expect, it } from 'vitest'
import { BUCKET_DISPLAY, HTTP_METHODS, parsePattern, serializePattern } from '../app/utils/audience-buckets'

// A pattern is stored as one string and edited as method + value. Round-tripping
// is what keeps a saved rule meaning the same thing after an edit — a silent
// drift here would widen or narrow an agent's permissions.
describe('parsePattern', () => {
  it('splits a method off a method-url pattern', () => {
    expect(parsePattern('POST https://api.openai.com/v1/*', 'method-url')).toEqual({
      method: 'POST',
      value: 'https://api.openai.com/v1/*',
    })
  })

  it('treats a bare host as any method', () => {
    expect(parsePattern('api.openai.com', 'method-url')).toEqual({ method: '*', value: 'api.openai.com' })
  })

  it('never splits a command pattern, even when it starts with a method-like word', () => {
    expect(parsePattern('GET /etc/hosts', 'command')).toEqual({ method: '*', value: 'GET /etc/hosts' })
  })
})

describe('serializePattern', () => {
  it('drops the method when it is the wildcard', () => {
    expect(serializePattern('*', 'api.openai.com', 'method-url')).toBe('api.openai.com')
  })

  it('keeps a specific method in front', () => {
    expect(serializePattern('DELETE', 'https://x.example/v1', 'method-url')).toBe('DELETE https://x.example/v1')
  })

  it('ignores the method for command shape', () => {
    expect(serializePattern('POST', 'ls -la', 'command')).toBe('ls -la')
  })

  it('trims surrounding whitespace so a stray space cannot create a second rule', () => {
    expect(serializePattern('*', '  api.openai.com  ', 'method-url')).toBe('api.openai.com')
  })
})

describe('round trip', () => {
  it.each([
    ['method-url', '*', 'api.openai.com'],
    ['method-url', 'GET', 'https://api.openai.com/v1/models'],
    ['command', '*', 'grep -r foo .'],
  ] as const)('%s %s %s survives parse → serialize unchanged', (shape, method, value) => {
    const stored = serializePattern(method, value, shape)
    const parsed = parsePattern(stored, shape)
    expect(serializePattern(parsed.method, parsed.value, shape)).toBe(stored)
  })
})

describe('bucket display', () => {
  it('offers the wildcard first in the method dropdown', () => {
    expect(HTTP_METHODS[0]).toBe('*')
  })

  it('covers every bucket exactly once, including the wildcard fallback', () => {
    const ids = BUCKET_DISPLAY.map(b => b.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('default')
  })

  it('gives every bucket the fields the editor renders', () => {
    for (const bucket of BUCKET_DISPLAY) {
      expect(bucket.label.length).toBeGreaterThan(0)
      expect(bucket.audiences.length).toBeGreaterThan(0)
      expect(['command', 'method-url']).toContain(bucket.patternShape)
    }
  })
})
