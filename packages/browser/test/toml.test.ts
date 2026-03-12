import { describe, expect, it } from 'vitest'
import { parseRulesToml } from '../src/toml'

describe('parseRulesToml', () => {
  it('parses allow rules', () => {
    const result = parseRulesToml(`
[[allow]]
pattern = "*.wikipedia.org"

[[allow]]
pattern = "*.github.com"
`)
    expect(result.rules.allow).toEqual([
      { pattern: '*.wikipedia.org' },
      { pattern: '*.github.com' },
    ])
  })

  it('parses deny rules', () => {
    const result = parseRulesToml(`
[[deny]]
pattern = "*.facebook.com"
`)
    expect(result.rules.deny).toEqual([
      { pattern: '*.facebook.com' },
    ])
  })

  it('parses grant_required rules with all options', () => {
    const result = parseRulesToml(`
[[grant_required]]
pattern = "*.bank.at/api/transfer"
methods = ["POST"]
approval = "once"
include_body = true
duration = "1h"
`)
    expect(result.rules.grantRequired).toEqual([{
      pattern: '*.bank.at/api/transfer',
      methods: ['POST'],
      approval: 'once',
      includeBody: true,
      duration: '1h',
    }])
  })

  it('parses default_action', () => {
    const result = parseRulesToml(`
default_action = "allow"

[[deny]]
pattern = "*.evil.com"
`)
    expect(result.default_action).toBe('allow')
    expect(result.rules.deny).toHaveLength(1)
  })

  it('ignores comments and empty lines', () => {
    const result = parseRulesToml(`
# This is a comment
default_action = "deny"

# Allow section
[[allow]]
pattern = "example.com"
`)
    expect(result.default_action).toBe('deny')
    expect(result.rules.allow).toHaveLength(1)
  })

  it('handles mixed sections', () => {
    const result = parseRulesToml(`
default_action = "deny"

[[allow]]
pattern = "*.wikipedia.org"

[[deny]]
pattern = "*.facebook.com"

[[allow]]
pattern = "docs.openape.at"

[[grant_required]]
pattern = "*.bank.at"
approval = "timed"
`)
    expect(result.rules.allow).toHaveLength(2)
    expect(result.rules.deny).toHaveLength(1)
    expect(result.rules.grantRequired).toHaveLength(1)
  })

  it('returns empty rules for empty content', () => {
    const result = parseRulesToml('')
    expect(result.rules).toEqual({})
  })
})
