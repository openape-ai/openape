import { describe, expect, it } from 'vitest'
import { evaluateRequest, findGrantRule, matchesRuleList, patternToRegExp } from '../src/rules'

describe('patternToRegExp', () => {
  it('matches exact domain', () => {
    const re = patternToRegExp('example.com')
    expect(re.test('https://example.com')).toBe(true)
    expect(re.test('https://example.com/')).toBe(true)
    expect(re.test('https://example.com/page')).toBe(true)
    expect(re.test('https://other.com')).toBe(false)
  })

  it('matches wildcard subdomain', () => {
    const re = patternToRegExp('*.example.com')
    expect(re.test('https://www.example.com')).toBe(true)
    expect(re.test('https://api.example.com')).toBe(true)
    expect(re.test('https://example.com')).toBe(false)
    expect(re.test('https://deep.sub.example.com')).toBe(false) // single * = one segment
  })

  it('matches path pattern', () => {
    const re = patternToRegExp('example.com/admin/*')
    expect(re.test('https://example.com/admin/users')).toBe(true)
    expect(re.test('https://example.com/admin/')).toBe(true)
    expect(re.test('https://example.com/public')).toBe(false)
  })

  it('matches ** for deep paths', () => {
    const re = patternToRegExp('example.com/api/**')
    expect(re.test('https://example.com/api/v1/users')).toBe(true)
    expect(re.test('https://example.com/api/v2/deep/nested')).toBe(true)
  })

  it('is case-insensitive', () => {
    const re = patternToRegExp('Example.COM')
    expect(re.test('https://example.com')).toBe(true)
    expect(re.test('https://EXAMPLE.COM')).toBe(true)
  })

  it('matches http and https', () => {
    const re = patternToRegExp('example.com')
    expect(re.test('https://example.com')).toBe(true)
    expect(re.test('http://example.com')).toBe(true)
  })
})

describe('matchesRuleList', () => {
  it('returns false for empty list', () => {
    expect(matchesRuleList('https://example.com', [])).toBe(false)
    expect(matchesRuleList('https://example.com', undefined)).toBe(false)
  })

  it('matches string rules', () => {
    const rules = ['*.wikipedia.org', '*.github.com']
    expect(matchesRuleList('https://en.wikipedia.org', rules)).toBe(true)
    expect(matchesRuleList('https://api.github.com', rules)).toBe(true)
    expect(matchesRuleList('https://facebook.com', rules)).toBe(false)
  })

  it('matches object rules', () => {
    const rules = [{ pattern: '*.example.com' }]
    expect(matchesRuleList('https://api.example.com', rules)).toBe(true)
    expect(matchesRuleList('https://other.com', rules)).toBe(false)
  })
})

describe('findGrantRule', () => {
  it('returns null for empty list', () => {
    expect(findGrantRule('https://example.com', 'GET', [])).toBeNull()
    expect(findGrantRule('https://example.com', 'GET', undefined)).toBeNull()
  })

  it('matches string rules (any method)', () => {
    const rules = ['*.bank.at']
    const result = findGrantRule('https://www.bank.at/dashboard', 'GET', rules)
    expect(result).toEqual({ pattern: '*.bank.at' })
  })

  it('matches method-specific rules', () => {
    const rules = [{ pattern: '*.bank.at/api/transfer', methods: ['POST'] }]
    expect(findGrantRule('https://www.bank.at/api/transfer', 'POST', rules)).toBeTruthy()
    expect(findGrantRule('https://www.bank.at/api/transfer', 'GET', rules)).toBeNull()
  })

  it('matches case-insensitive methods', () => {
    const rules = [{ pattern: 'example.com', methods: ['POST'] }]
    expect(findGrantRule('https://example.com/', 'post', rules)).toBeTruthy()
  })

  it('returns first matching rule', () => {
    const rules = [
      { pattern: '*.bank.at/api/transfer', methods: ['POST'], approval: 'once' as const },
      { pattern: '*.bank.at', approval: 'timed' as const },
    ]
    const result = findGrantRule('https://www.bank.at/api/transfer', 'POST', rules)
    expect(result?.approval).toBe('once')
  })
})

describe('evaluateRequest', () => {
  const rules = {
    allow: ['*.wikipedia.org', '*.github.com'],
    deny: ['*.facebook.com', '*.tiktok.com'],
    grantRequired: [
      { pattern: '*.bank.at/api/transfer', methods: ['POST'], approval: 'once' as const },
      '*.bank.at',
    ],
  }

  it('denies URLs in deny list (highest priority)', () => {
    expect(evaluateRequest('https://www.facebook.com/page', 'GET', rules)).toBe('deny')
  })

  it('allows URLs in allow list', () => {
    expect(evaluateRequest('https://en.wikipedia.org/wiki/Test', 'GET', rules)).toBe('allow')
  })

  it('requires grant for grant_required URLs', () => {
    const result = evaluateRequest('https://www.bank.at/dashboard', 'GET', rules)
    expect(result).toEqual({ decision: 'grant_required', rule: expect.objectContaining({ pattern: '*.bank.at' }) })
  })

  it('matches method-specific grant rules', () => {
    const result = evaluateRequest('https://www.bank.at/api/transfer', 'POST', rules)
    expect(result).toEqual({ decision: 'grant_required', rule: expect.objectContaining({ approval: 'once' }) })
  })

  it('deny overrides allow and grant_required', () => {
    const mixed = {
      allow: ['*.evil.com'],
      deny: ['*.evil.com'],
      grantRequired: ['*.evil.com'],
    }
    expect(evaluateRequest('https://www.evil.com', 'GET', mixed)).toBe('deny')
  })

  it('grant_required overrides allow', () => {
    const mixed = {
      allow: ['*.bank.at'],
      grantRequired: [{ pattern: '*.bank.at/api/transfer', methods: ['POST'] }],
    }
    const result = evaluateRequest('https://www.bank.at/api/transfer', 'POST', mixed)
    expect(result).toEqual({ decision: 'grant_required', rule: expect.any(Object) })

    // GET should be allowed (not in grant_required methods)
    expect(evaluateRequest('https://www.bank.at/api/transfer', 'GET', mixed)).toBe('allow')
  })

  it('uses default action for unmatched URLs', () => {
    expect(evaluateRequest('https://unknown.com', 'GET', rules, 'deny')).toBe('deny')
    expect(evaluateRequest('https://unknown.com', 'GET', rules, 'allow')).toBe('allow')
  })

  it('default action grant_required returns rule', () => {
    const result = evaluateRequest('https://unknown.com', 'GET', {}, 'grant_required')
    expect(result).toEqual({ decision: 'grant_required', rule: { pattern: '*' } })
  })
})
