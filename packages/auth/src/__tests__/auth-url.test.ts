import type { DDISARecord } from '@openape/core'
import type { IdPConfig } from '../sp/discovery.js'
import { describe, expect, it } from 'vitest'
import { createAuthorizationURL } from '../sp/auth-url.js'

describe('createAuthorizationURL', () => {
  const idpConfig: IdPConfig = {
    idpUrl: 'https://idp.example.com',
    mode: 'open',
    record: { version: 'ddisa1', idp: 'https://idp.example.com', mode: 'open', raw: 'v=ddisa1 idp=https://idp.example.com' } as DDISARecord,
  }

  it('generates a valid authorization URL', async () => {
    const result = await createAuthorizationURL(idpConfig, {
      clientId: 'sp.example.com',
      redirectUri: 'https://sp.example.com/callback',
    })

    expect(result.url).toContain('https://idp.example.com/authorize?')
    expect(result.url).toContain('response_type=code')
    expect(result.url).toContain('client_id=sp.example.com')
    expect(result.url).toContain('code_challenge_method=S256')

    expect(result.flowState.codeVerifier).toBeTruthy()
    expect(result.flowState.state).toBeTruthy()
    expect(result.flowState.nonce).toBeTruthy()
    expect(result.flowState.idpUrl).toBe('https://idp.example.com')
  })

  it('includes login_hint when email is provided', async () => {
    const result = await createAuthorizationURL(idpConfig, {
      clientId: 'sp.example.com',
      redirectUri: 'https://sp.example.com/callback',
      email: 'alice@example.com',
    })

    expect(result.url).toContain('login_hint=alice%40example.com')
  })

  it('generates unique state/nonce per call', async () => {
    const r1 = await createAuthorizationURL(idpConfig, { clientId: 'sp', redirectUri: 'https://sp/cb' })
    const r2 = await createAuthorizationURL(idpConfig, { clientId: 'sp', redirectUri: 'https://sp/cb' })
    expect(r1.flowState.state).not.toBe(r2.flowState.state)
    expect(r1.flowState.nonce).not.toBe(r2.flowState.nonce)
  })
})
