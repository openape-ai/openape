import { describe, expect, it } from 'vitest'
import { extractDomain, parseDDISARecord } from '../dns/parser.js'

describe('parseDDISARecord', () => {
  it('parses a minimal record with version tag and idp', () => {
    const result = parseDDISARecord('v=ddisa1 idp=https://idp.example.com')
    expect(result).toEqual({
      version: 'ddisa1',
      idp: 'https://idp.example.com',
      raw: 'v=ddisa1 idp=https://idp.example.com',
    })
  })

  it('parses a full record with mode and priority', () => {
    const result = parseDDISARecord('v=ddisa1 idp=https://idp.example.com; mode=allowlist-user; priority=10')
    expect(result).toEqual({
      version: 'ddisa1',
      idp: 'https://idp.example.com',
      mode: 'allowlist-user',
      priority: 10,
      raw: 'v=ddisa1 idp=https://idp.example.com; mode=allowlist-user; priority=10',
    })
  })

  it('parses record with policy_endpoint', () => {
    const result = parseDDISARecord('v=ddisa1 idp=https://idp.example.com; policy=https://idp.example.com/policy')
    expect(result).toMatchObject({
      version: 'ddisa1',
      idp: 'https://idp.example.com',
      policy_endpoint: 'https://idp.example.com/policy',
    })
  })

  it('returns null for record without version tag', () => {
    const result = parseDDISARecord('idp=https://idp.example.com; mode=open')
    expect(result).toBeNull()
  })

  it('returns null for record with wrong version', () => {
    const result = parseDDISARecord('v=ddisa2 idp=https://idp.example.com')
    expect(result).toBeNull()
  })

  it('returns null for record without idp', () => {
    const result = parseDDISARecord('v=ddisa1 mode=open; priority=10')
    expect(result).toBeNull()
  })

  it('ignores invalid mode values', () => {
    const result = parseDDISARecord('v=ddisa1 idp=https://idp.example.com; mode=invalid')
    expect(result).toEqual({
      version: 'ddisa1',
      idp: 'https://idp.example.com',
      raw: 'v=ddisa1 idp=https://idp.example.com; mode=invalid',
    })
  })

  it('handles all valid modes', () => {
    for (const mode of ['open', 'allowlist-admin', 'allowlist-user', 'deny'] as const) {
      const result = parseDDISARecord(`v=ddisa1 idp=https://idp.example.com; mode=${mode}`)
      expect(result?.mode).toBe(mode)
    }
  })

  it('skips parts without = separator', () => {
    const result = parseDDISARecord('v=ddisa1 idp=https://idp.example.com; garbage; mode=open')
    expect(result?.idp).toBe('https://idp.example.com')
    expect(result?.mode).toBe('open')
  })

  it('handles extra whitespace', () => {
    const result = parseDDISARecord('  v=ddisa1 idp = https://idp.example.com ;  mode = open  ')
    expect(result?.idp).toBe('https://idp.example.com')
    expect(result?.mode).toBe('open')
  })

  it('returns null for empty string', () => {
    expect(parseDDISARecord('')).toBeNull()
  })

  it('returns null for version-only string without fields', () => {
    expect(parseDDISARecord('v=ddisa1')).toBeNull()
  })
})

describe('extractDomain', () => {
  it('extracts domain from email', () => {
    expect(extractDomain('alice@example.com')).toBe('example.com')
  })

  it('throws for invalid email', () => {
    expect(() => extractDomain('invalid')).toThrow('Invalid email')
  })
})
