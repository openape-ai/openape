import { describe, expect, it, vi } from 'vitest'
import type { RPConfig, WebAuthnCredential } from '../idp/webauthn/types.js'

vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn().mockResolvedValue({
    challenge: 'test-challenge-base64url',
    rp: { name: 'Test', id: 'localhost' },
    user: { id: 'dXNlci1pZA', name: 'test@example.com', displayName: 'Test' },
    pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
    timeout: 60000,
    attestation: 'none',
  }),
  verifyRegistrationResponse: vi.fn().mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: {
        id: 'credential-id-base64url',
        publicKey: new Uint8Array([1, 2, 3, 4]),
        counter: 0,
        transports: ['internal'],
      },
      credentialDeviceType: 'multiDevice',
      credentialBackedUp: true,
    },
  }),
}))

const rpConfig: RPConfig = {
  rpName: 'Test',
  rpID: 'localhost',
  origin: 'http://localhost:3000',
}

describe('createRegistrationOptions', () => {
  it('should generate registration options', async () => {
    const { createRegistrationOptions } = await import('../idp/webauthn/registration.js')

    const result = await createRegistrationOptions(rpConfig, 'test@example.com', 'Test User')

    expect(result.options).toBeDefined()
    expect(result.challenge).toBe('test-challenge-base64url')
    expect(result.options.rp.name).toBe('Test')
  })

  it('should pass existing credentials as excludeCredentials', async () => {
    const { generateRegistrationOptions } = await import('@simplewebauthn/server')
    const { createRegistrationOptions } = await import('../idp/webauthn/registration.js')

    const existing: WebAuthnCredential[] = [{
      credentialId: 'existing-cred',
      userEmail: 'test@example.com',
      publicKey: 'AQIDBA',
      counter: 5,
      transports: ['usb'],
      deviceType: 'singleDevice',
      backedUp: false,
      createdAt: Date.now(),
    }]

    await createRegistrationOptions(rpConfig, 'test@example.com', 'Test', existing)

    expect(generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        excludeCredentials: [{ id: 'existing-cred', transports: ['usb'] }],
      }),
    )
  })
})

describe('verifyRegistration', () => {
  it('should verify and return credential on success', async () => {
    const { verifyRegistration } = await import('../idp/webauthn/registration.js')

    const result = await verifyRegistration(
      { id: 'test', rawId: 'test', response: {} as any, type: 'public-key', clientExtensionResults: {} },
      'test-challenge',
      rpConfig,
      'test@example.com',
    )

    expect(result.verified).toBe(true)
    expect(result.credential).toBeDefined()
    expect(result.credential!.credentialId).toBe('credential-id-base64url')
    expect(result.credential!.userEmail).toBe('test@example.com')
    expect(result.credential!.counter).toBe(0)
    expect(result.credential!.deviceType).toBe('multiDevice')
    expect(result.credential!.backedUp).toBe(true)
  })

  it('should return verified false on failure', async () => {
    const { verifyRegistrationResponse } = await import('@simplewebauthn/server')
    vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({
      verified: false,
      registrationInfo: undefined,
    })

    const { verifyRegistration } = await import('../idp/webauthn/registration.js')

    const result = await verifyRegistration(
      { id: 'test', rawId: 'test', response: {} as any, type: 'public-key', clientExtensionResults: {} },
      'test-challenge',
      rpConfig,
      'test@example.com',
    )

    expect(result.verified).toBe(false)
    expect(result.credential).toBeUndefined()
  })
})

describe('base64URL encoding', () => {
  it('should roundtrip Uint8Array through Base64URL', async () => {
    const { base64URLToUint8Array, uint8ArrayToBase64URL } = await import('../idp/webauthn/registration.js')

    const original = new Uint8Array([0, 1, 2, 128, 255, 63, 62])
    const encoded = uint8ArrayToBase64URL(original)
    const decoded = base64URLToUint8Array(encoded)

    expect(decoded).toEqual(original)
    expect(encoded).not.toContain('+')
    expect(encoded).not.toContain('/')
    expect(encoded).not.toContain('=')
  })
})
