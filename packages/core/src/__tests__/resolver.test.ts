import { describe, expect, it } from 'vitest'
import { resolveDDISA, resolveIdP } from '../dns/resolver.js'

describe('resolveDDISA with mock records', () => {
  const mockRecords = {
    'example.com': { version: 'ddisa1' as const, idp: 'https://idp.example.com', mode: 'open' as const },
  }

  it('resolves a mocked domain', async () => {
    const record = await resolveDDISA('example.com', { mockRecords })
    expect(record).toMatchObject({ version: 'ddisa1', idp: 'https://idp.example.com', mode: 'open' })
    expect(record?.raw).toContain('v=ddisa1')
  })

  it('returns null for unknown domain', async () => {
    expect(await resolveDDISA('unknown.com', { mockRecords })).toBeNull()
    expect(await resolveIdP('unknown.com', { mockRecords })).toBeNull()
  })

  it('resolves just the IdP URL', async () => {
    expect(await resolveIdP('example.com', { mockRecords })).toBe('https://idp.example.com')
  })
})

describe('resolveDDISA with env-based mock records', () => {
  it('resolves from DDISA_MOCK_RECORDS env var', async () => {
    process.env.DDISA_MOCK_RECORDS = JSON.stringify({ 'env.com': { idp: 'http://localhost:3000', mode: 'open' } })
    try {
      const record = await resolveDDISA('env.com')
      expect(record).toMatchObject({ version: 'ddisa1', idp: 'http://localhost:3000', mode: 'open' })
    }
    finally { delete process.env.DDISA_MOCK_RECORDS }
  })

  it('omits mode from raw when not set', async () => {
    process.env.DDISA_MOCK_RECORDS = JSON.stringify({ 'nomode.com': { idp: 'https://x.com' } })
    try {
      const record = await resolveDDISA('nomode.com')
      expect(record?.raw).toBe('v=ddisa1 idp=https://x.com')
    }
    finally { delete process.env.DDISA_MOCK_RECORDS }
  })

  it('ignores invalid JSON in env var and falls through', async () => {
    process.env.DDISA_MOCK_RECORDS = 'not-json'
    try {
      const record = await resolveDDISA('x.org', {
        mockRecords: { 'x.org': { version: 'ddisa1', idp: 'https://fallback.com', mode: 'open' as const } },
      })
      expect(record?.idp).toBe('https://fallback.com')
    }
    finally { delete process.env.DDISA_MOCK_RECORDS }
  })
})
