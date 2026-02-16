import { describe, it, expect } from 'vitest'
import { resolveDDISA, resolveIdP, clearDNSCache } from '../dns/resolver.js'

describe('resolveDDISA with mock records', () => {
  const mockRecords = {
    'example.com': { idp: 'https://idp.example.com', mode: 'allowlist-user' as const },
    'open.com': { idp: 'https://login.open.com', mode: 'open' as const },
  }

  it('resolves a mocked domain', async () => {
    const record = await resolveDDISA('example.com', { mockRecords })
    expect(record).toMatchObject({
      idp: 'https://idp.example.com',
      mode: 'allowlist-user',
    })
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

describe('DNS cache', () => {
  it('clears cache without error', () => {
    expect(() => clearDNSCache()).not.toThrow()
  })
})
