import type { RPConfig, WebAuthnCredential } from '../idp/webauthn/types.js'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import { describe, expect, it } from 'vitest'
import { base64URLToUint8Array, createRegistrationOptions, uint8ArrayToBase64URL, verifyRegistration } from '../idp/webauthn/registration.js'
import { createTestAuthenticator } from './webauthn-test-authenticator.js'

const rpConfig: RPConfig = {
  rpName: 'OpenApe Test',
  rpID: 'id.openape.test',
  origin: 'https://id.openape.test',
}

const email = 'ape@openape.test'
const name = 'Test Ape'

function existingCredential(credentialId: string): WebAuthnCredential {
  return {
    credentialId,
    userEmail: email,
    publicKey: 'irrelevant',
    counter: 0,
    transports: ['internal'],
    deviceType: 'singleDevice',
    backedUp: false,
    createdAt: Date.now(),
  }
}

describe('base64URL encoding', () => {
  it('roundtrips Uint8Array through Base64URL', () => {
    const original = new Uint8Array([0, 1, 2, 128, 255, 63, 62])
    const encoded = uint8ArrayToBase64URL(original)
    const decoded = base64URLToUint8Array(encoded)

    expect(decoded).toEqual(original)
    expect(encoded).not.toContain('+')
    expect(encoded).not.toContain('/')
    expect(encoded).not.toContain('=')
  })
})

describe('createRegistrationOptions', () => {
  it('generates registration options with RP config', async () => {
    const { options, challenge } = await createRegistrationOptions(rpConfig, email, name)

    expect(options.rp).toEqual({ name: rpConfig.rpName, id: rpConfig.rpID })
    expect(options.user.name).toBe(email)
    expect(options.user.displayName).toBe(name)
    expect(options.attestation).toBe('none')
    expect(options.authenticatorSelection?.residentKey).toBe('preferred')
    expect(options.authenticatorSelection?.userVerification).toBe('preferred')
    expect(options.excludeCredentials).toEqual([])
    expect(challenge).toBe(options.challenge)
    expect(isoBase64URL.isBase64URL(challenge)).toBe(true)
  })

  it('honors verification, resident key and attestation overrides', async () => {
    const { options } = await createRegistrationOptions({
      ...rpConfig,
      requireUserVerification: true,
      residentKey: 'required',
      attestationType: 'direct',
    }, email, name)

    expect(options.authenticatorSelection?.userVerification).toBe('required')
    expect(options.authenticatorSelection?.residentKey).toBe('required')
    expect(options.attestation).toBe('direct')
  })

  it('excludes existing credentials', async () => {
    const existing = [existingCredential('cred-a'), existingCredential('cred-b')]

    const { options } = await createRegistrationOptions(rpConfig, email, name, existing)

    expect(options.excludeCredentials).toEqual([
      { id: 'cred-a', transports: ['internal'], type: 'public-key' },
      { id: 'cred-b', transports: ['internal'], type: 'public-key' },
    ])
  })
})

describe('verifyRegistration', () => {
  it('verifies a real attestation and returns the stored credential', async () => {
    const authenticator = createTestAuthenticator()
    const { challenge } = await createRegistrationOptions(rpConfig, email, name)
    const response = authenticator.createRegistrationResponse({
      challenge,
      origin: rpConfig.origin,
      rpId: rpConfig.rpID,
    })

    const before = Date.now()
    const result = await verifyRegistration(response, challenge, rpConfig, email)

    expect(result.verified).toBe(true)
    expect(result.credential).toMatchObject({
      credentialId: authenticator.credentialId,
      userEmail: email,
      counter: 0,
      transports: ['internal'],
      deviceType: 'singleDevice',
      backedUp: false,
    })
    expect(result.credential?.createdAt).toBeGreaterThanOrEqual(before)
    // The stored public key is Base64URL and decodes back to a COSE key
    expect(isoBase64URL.isBase64URL(result.credential?.publicKey ?? '')).toBe(true)
    expect(base64URLToUint8Array(result.credential?.publicKey ?? '').length).toBeGreaterThan(0)
  })

  it('rejects a response signed over a different challenge', async () => {
    const authenticator = createTestAuthenticator()
    const { challenge } = await createRegistrationOptions(rpConfig, email, name)
    const { challenge: otherChallenge } = await createRegistrationOptions(rpConfig, email, name)
    const response = authenticator.createRegistrationResponse({
      challenge: otherChallenge,
      origin: rpConfig.origin,
      rpId: rpConfig.rpID,
    })

    await expect(verifyRegistration(response, challenge, rpConfig, email))
      .rejects
      .toThrow(/challenge/)
  })

  it('rejects a response from a different origin', async () => {
    const authenticator = createTestAuthenticator()
    const { challenge } = await createRegistrationOptions(rpConfig, email, name)
    const response = authenticator.createRegistrationResponse({
      challenge,
      origin: 'https://evil.example',
      rpId: rpConfig.rpID,
    })

    await expect(verifyRegistration(response, challenge, rpConfig, email))
      .rejects
      .toThrow(/origin/)
  })

  it('rejects a response bound to a different RP ID', async () => {
    const authenticator = createTestAuthenticator()
    const { challenge } = await createRegistrationOptions(rpConfig, email, name)
    const response = authenticator.createRegistrationResponse({
      challenge,
      origin: rpConfig.origin,
      rpId: 'other.example',
    })

    await expect(verifyRegistration(response, challenge, rpConfig, email))
      .rejects
      .toThrow(/RP ID/)
  })

  it('rejects when user verification is required but missing', async () => {
    const strictConfig: RPConfig = { ...rpConfig, requireUserVerification: true }
    const authenticator = createTestAuthenticator()
    const { challenge } = await createRegistrationOptions(strictConfig, email, name)
    const response = authenticator.createRegistrationResponse({
      challenge,
      origin: strictConfig.origin,
      rpId: strictConfig.rpID,
      userVerified: false,
    })

    await expect(verifyRegistration(response, challenge, strictConfig, email))
      .rejects
      .toThrow(/[Uu]ser verification/)
  })
})
