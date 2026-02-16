import { describe, it, expect } from 'vitest'
import { parseDDISARecord, extractDomain } from '../dns/parser.js'

describe('parseDDISARecord', () => {
  it('parses a minimal record with only idp', () => {
    const result = parseDDISARecord('idp=https://idp.example.com')
    expect(result).toEqual({
      idp: 'https://idp.example.com',
      raw: 'idp=https://idp.example.com',
    })
  })

  it('parses a full record with mode and priority', () => {
    const result = parseDDISARecord('idp=https://idp.example.com; mode=allowlist-user; priority=10')
    expect(result).toEqual({
      idp: 'https://idp.example.com',
      mode: 'allowlist-user',
      priority: 10,
      raw: 'idp=https://idp.example.com; mode=allowlist-user; priority=10',
    })
  })

  it('parses record with policy_endpoint', () => {
    const result = parseDDISARecord('idp=https://idp.example.com; policy=https://idp.example.com/policy')
    expect(result).toMatchObject({
      idp: 'https://idp.example.com',
      policy_endpoint: 'https://idp.example.com/policy',
    })
  })

  it('returns null for record without idp', () => {
    const result = parseDDISARecord('mode=open; priority=10')
    expect(result).toBeNull()
  })

  it('ignores invalid mode values', () => {
    const result = parseDDISARecord('idp=https://idp.example.com; mode=invalid')
    expect(result).toEqual({
      idp: 'https://idp.example.com',
      raw: 'idp=https://idp.example.com; mode=invalid',
    })
  })

  it('handles all valid modes', () => {
    for (const mode of ['open', 'allowlist-admin', 'allowlist-user', 'deny'] as const) {
      const result = parseDDISARecord(`idp=https://idp.example.com; mode=${mode}`)
      expect(result?.mode).toBe(mode)
    }
  })

  it('handles extra whitespace', () => {
    const result = parseDDISARecord('  idp = https://idp.example.com ;  mode = open  ')
    expect(result?.idp).toBe('https://idp.example.com')
    expect(result?.mode).toBe('open')
  })
})

describe('extractDomain', () => {
  it('extracts domain from email', () => {
    expect(extractDomain('alice@example.com')).toBe('example.com')
  })

  it('throws for invalid email', () => {
    expect(() => extractDomain('invalid')).toThrow('Invalid email')
  })

  it('throws for empty email', () => {
    expect(() => extractDomain('')).toThrow('Invalid email')
  })
})
