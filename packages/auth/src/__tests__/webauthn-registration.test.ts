import { describe, expect, it } from 'vitest'

describe('base64URL encoding', () => {
  it('roundtrips Uint8Array through Base64URL', async () => {
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

// TODO: These need real integration tests against @simplewebauthn/server
// (not mock-wiring tests). Requires a WebAuthn test harness.
describe.skip('createRegistrationOptions', () => {
  it.skip('generates registration options with RP config', () => {})
  it.skip('excludes existing credentials', () => {})
})

describe.skip('verifyRegistration', () => {
  it.skip('verifies and returns credential on success', () => {})
  it.skip('returns verified false on failure', () => {})
})
