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

  it('rejects an idp= URL that is not https:// (#281)', () => {
    // DNS poisoning attack vector: a TXT record claiming
    // `idp=http://attacker.example` — every SP downstream would
    // then fetch JWKS over plaintext from a hostile origin.
    expect(parseDDISARecord('v=ddisa1 idp=http://idp.example.com')).toBeNull()
    expect(parseDDISARecord('v=ddisa1 idp=javascript:alert(1)')).toBeNull()
    expect(parseDDISARecord('v=ddisa1 idp=ftp://idp.example.com')).toBeNull()
    expect(parseDDISARecord('v=ddisa1 idp=not-a-url')).toBeNull()
  })

  it('rejects an empty idp= value', () => {
    expect(parseDDISARecord('v=ddisa1 idp=')).toBeNull()
  })

  it('rejects an idp= URL with embedded credentials', () => {
    // `https://attacker:x@idp.victim.com` — the credentials travel
    // with whatever consumer copies the raw string forward.
    expect(parseDDISARecord('v=ddisa1 idp=https://attacker:secret@idp.victim.com')).toBeNull()
  })

  it('rejects an idp= URL with non-ASCII hostnames (IDN homograph defence)', () => {
    // `idp.example` looks legit but the `а` is Cyrillic U+0430.
    expect(parseDDISARecord('v=ddisa1 idp=https://idp.exаmple.com')).toBeNull()
  })

  it('accepts http:// only when OPENAPE_DDISA_ALLOW_HTTP=1 is set (dev escape hatch)', () => {
    const orig = process.env.OPENAPE_DDISA_ALLOW_HTTP
    try {
      process.env.OPENAPE_DDISA_ALLOW_HTTP = '1'
      const r = parseDDISARecord('v=ddisa1 idp=http://localhost:3000')
      expect(r?.idp).toBe('http://localhost:3000')
    }
    finally {
      if (orig === undefined) delete process.env.OPENAPE_DDISA_ALLOW_HTTP
      else process.env.OPENAPE_DDISA_ALLOW_HTTP = orig
    }
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
