import { describe, expect, it, vi } from 'vitest'
import type { RPConfig, WebAuthnCredential } from '../idp/webauthn/types.js'

vi.mock('@simplewebauthn/server', () => ({
  generateAuthenticationOptions: vi.fn().mockResolvedValue({
    challenge: 'auth-challenge-base64url',
    timeout: 60000,
    rpId: 'localhost',
    allowCredentials: [],
    userVerification: 'preferred',
  }),
  verifyAuthenticationResponse: vi.fn().mockResolvedValue({
    verified: true,
    authenticationInfo: {
      newCounter: 42,
      credentialID: 'credential-id-base64url',
    },
  }),
}))

const rpConfig: RPConfig = {
  rpName: 'Test',
  rpID: 'localhost',
  origin: 'http://localhost:3000',
}

const testCredential: WebAuthnCredential = {
  credentialId: 'credential-id-base64url',
  userEmail: 'test@example.com',
  publicKey: 'AQIDBA',
  counter: 10,
  transports: ['internal'],
  deviceType: 'multiDevice',
  backedUp: true,
  createdAt: Date.now(),
}

describe('createAuthenticationOptions', () => {
  it('should generate authentication options without credentials', async () => {
    const { createAuthenticationOptions } = await import('../idp/webauthn/authentication.js')

    const result = await createAuthenticationOptions(rpConfig)

    expect(result.options).toBeDefined()
    expect(result.challenge).toBe('auth-challenge-base64url')
  })

  it('should pass credentials as allowCredentials', async () => {
    const { generateAuthenticationOptions } = await import('@simplewebauthn/server')
    const { createAuthenticationOptions } = await import('../idp/webauthn/authentication.js')

    await createAuthenticationOptions(rpConfig, [testCredential])

    expect(generateAuthenticationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        allowCredentials: [{ id: 'credential-id-base64url', transports: ['internal'] }],
      }),
    )
  })
})

describe('verifyAuthentication', () => {
  it('should verify and return new counter on success', async () => {
    const { verifyAuthentication } = await import('../idp/webauthn/authentication.js')

    const result = await verifyAuthentication(
      { id: 'test', rawId: 'test', response: {} as any, type: 'public-key', clientExtensionResults: {} },
      'test-challenge',
      rpConfig,
      testCredential,
    )

    expect(result.verified).toBe(true)
    expect(result.newCounter).toBe(42)
    expect(result.credentialId).toBe('credential-id-base64url')
  })

  it('should return verified false on failure', async () => {
    const { verifyAuthenticationResponse } = await import('@simplewebauthn/server')
    vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({
      verified: false,
      authenticationInfo: { newCounter: 0, credentialID: '', credentialBackedUp: false, credentialDeviceType: 'singleDevice', origin: '', rpID: '', userVerified: false },
    })

    const { verifyAuthentication } = await import('../idp/webauthn/authentication.js')

    const result = await verifyAuthentication(
      { id: 'test', rawId: 'test', response: {} as any, type: 'public-key', clientExtensionResults: {} },
      'test-challenge',
      rpConfig,
      testCredential,
    )

    expect(result.verified).toBe(false)
    expect(result.newCounter).toBeUndefined()
  })
})
