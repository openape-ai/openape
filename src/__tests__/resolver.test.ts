import { describe, expect, it } from 'vitest'
import { clearDNSCache, resolveDDISA, resolveIdP } from '../dns/resolver.js'

describe('resolveDDISA with mock records', () => {
  const mockRecords = {
    'example.com': { idp: 'https://idp.example.com', mode: 'allowlist-user' as const },
    'open.com': { idp: 'https://login.open.com', mode: 'open' as const },
  }

  it('resolves a mocked domain', async () => {
    const record = await resolveDDISA('example.com', { mockRecords })
    expect(record).toMatchObject({
      version: 'ddisa1',
      idp: 'https://idp.example.com',
      mode: 'allowlist-user',
    })
    expect(record?.raw).toContain('v=ddisa1')
    expect(record?.raw).toContain('idp=https://idp.example.com')
  })

  it('returns null for unknown domain', async () => {
    const record = await resolveDDISA('unknown.com', { mockRecords })
    expect(record).toBeNull()
  })

  it('resolves just the IdP URL', async () => {
    const url = await resolveIdP('example.com', { mockRecords })
    expect(url).toBe('https://idp.example.com')
  })

  it('returns null IdP for unknown domain', async () => {
    const url = await resolveIdP('unknown.com', { mockRecords })
    expect(url).toBeNull()
  })
})

describe('resolveDDISA with env-based mock records', () => {
  const envValue = JSON.stringify({
    'example.org': { idp: 'http://localhost:3000', mode: 'open' },
  })

  it('resolves from DDISA_MOCK_RECORDS env var', async () => {
    process.env.DDISA_MOCK_RECORDS = envValue
    try {
      const record = await resolveDDISA('example.org')
      expect(record).toMatchObject({
        version: 'ddisa1',
        idp: 'http://localhost:3000',
        mode: 'open',
      })
      expect(record?.raw).toContain('v=ddisa1')
      expect(record?.raw).toContain('idp=http://localhost:3000')
    }
    finally {
      delete process.env.DDISA_MOCK_RECORDS
    }
  })

  it('falls through for domains not in env mock', async () => {
    process.env.DDISA_MOCK_RECORDS = envValue
    try {
      const record = await resolveDDISA('unknown.com', {
        mockRecords: { 'unknown.com': { idp: 'https://fallback.com', mode: 'open' as const } },
      })
      expect(record?.idp).toBe('https://fallback.com')
    }
    finally {
      delete process.env.DDISA_MOCK_RECORDS
    }
  })

  it('ignores invalid JSON in env var', async () => {
    process.env.DDISA_MOCK_RECORDS = 'not-json'
    try {
      const record = await resolveDDISA('example.org', {
        mockRecords: { 'example.org': { idp: 'https://option-mock.com', mode: 'open' as const } },
      })
      expect(record?.idp).toBe('https://option-mock.com')
    }
    finally {
      delete process.env.DDISA_MOCK_RECORDS
    }
  })
})

describe('dns cache', () => {
  it('clears cache without error', () => {
    expect(() => clearDNSCache()).not.toThrow()
  })
})
