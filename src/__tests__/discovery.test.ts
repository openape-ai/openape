import { describe, expect, it } from 'vitest'
import { discoverIdP } from '../sp/discovery.js'

describe('discoverIdP', () => {
  const mockRecords = {
    'example.com': { version: 'ddisa1', idp: 'https://idp.example.com', mode: 'allowlist-user' as const },
  }

  it('discovers IdP from email', async () => {
    const config = await discoverIdP('alice@example.com', { mockRecords })
    expect(config).not.toBeNull()
    expect(config!.idpUrl).toBe('https://idp.example.com')
    expect(config!.mode).toBe('allowlist-user')
    expect(config!.record.version).toBe('ddisa1')
  })

  it('returns null for unknown domain', async () => {
    const config = await discoverIdP('bob@unknown.com', { mockRecords })
    expect(config).toBeNull()
  })
})
