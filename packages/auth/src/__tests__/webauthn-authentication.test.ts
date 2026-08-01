import type { TestAuthenticator } from './webauthn-test-authenticator.js'
import type { RPConfig, WebAuthnCredential } from '../idp/webauthn/types.js'
import { isoBase64URL } from '@simplewebauthn/server/helpers'
import { describe, expect, it } from 'vitest'
import { createAuthenticationOptions, verifyAuthentication } from '../idp/webauthn/authentication.js'
import { createRegistrationOptions, verifyRegistration } from '../idp/webauthn/registration.js'
import { createTestAuthenticator } from './webauthn-test-authenticator.js'

const rpConfig: RPConfig = {
  rpName: 'OpenApe Test',
  rpID: 'id.openape.test',
  origin: 'https://id.openape.test',
}

const email = 'ape@openape.test'

/** Run the real registration pipeline to obtain a stored credential */
async function registerCredential(authenticator: TestAuthenticator, config: RPConfig = rpConfig): Promise<WebAuthnCredential> {
  const { challenge } = await createRegistrationOptions(config, email, 'Test Ape')
  const response = authenticator.createRegistrationResponse({
    challenge,
    origin: config.origin,
    rpId: config.rpID,
  })
  const result = await verifyRegistration(response, challenge, config, email)
  if (!result.credential) {
    throw new Error('Test registration unexpectedly failed')
  }
  return result.credential
}

describe('createAuthenticationOptions', () => {
  it('generates authentication options', async () => {
    const { options, challenge } = await createAuthenticationOptions(rpConfig)

    expect(options.rpId).toBe(rpConfig.rpID)
    expect(options.userVerification).toBe('preferred')
    expect(options.allowCredentials).toBeUndefined()
    expect(challenge).toBe(options.challenge)
    expect(isoBase64URL.isBase64URL(challenge)).toBe(true)
  })

  it('requires user verification when configured', async () => {
    const { options } = await createAuthenticationOptions({ ...rpConfig, requireUserVerification: true })

    expect(options.userVerification).toBe('required')
  })

  it('passes credentials as allowCredentials', async () => {
    const authenticator = createTestAuthenticator()
    const credential = await registerCredential(authenticator)

    const { options } = await createAuthenticationOptions(rpConfig, [credential])

    expect(options.allowCredentials).toEqual([
      { id: authenticator.credentialId, transports: ['internal'], type: 'public-key' },
    ])
  })
})

describe('verifyAuthentication', () => {
  it('verifies a real assertion and returns the new counter', async () => {
    const authenticator = createTestAuthenticator()
    const credential = await registerCredential(authenticator)
    const { challenge } = await createAuthenticationOptions(rpConfig, [credential])
    const response = authenticator.createAuthenticationResponse({
      challenge,
      origin: rpConfig.origin,
      rpId: rpConfig.rpID,
      counter: 5,
    })

    const result = await verifyAuthentication(response, challenge, rpConfig, credential)

    expect(result).toEqual({
      verified: true,
      newCounter: 5,
      credentialId: authenticator.credentialId,
    })
  })

  it('accepts counter-less authenticators (both counters zero)', async () => {
    const authenticator = createTestAuthenticator()
    const credential = await registerCredential(authenticator)
    const { challenge } = await createAuthenticationOptions(rpConfig, [credential])
    const response = authenticator.createAuthenticationResponse({
      challenge,
      origin: rpConfig.origin,
      rpId: rpConfig.rpID,
      counter: 0,
    })

    const result = await verifyAuthentication(response, challenge, rpConfig, credential)

    expect(result.verified).toBe(true)
    expect(result.newCounter).toBe(0)
  })

  it('rejects a counter regression (cloned authenticator)', async () => {
    const authenticator = createTestAuthenticator()
    const credential = { ...await registerCredential(authenticator), counter: 10 }
    const { challenge } = await createAuthenticationOptions(rpConfig, [credential])
    const response = authenticator.createAuthenticationResponse({
      challenge,
      origin: rpConfig.origin,
      rpId: rpConfig.rpID,
      counter: 10,
    })

    await expect(verifyAuthentication(response, challenge, rpConfig, credential))
      .rejects
      .toThrow(/counter/)
  })

  it('returns verified false for a signature from the wrong key', async () => {
    const authenticator = createTestAuthenticator()
    const impostor = createTestAuthenticator()
    const credential = await registerCredential(authenticator)
    const { challenge } = await createAuthenticationOptions(rpConfig, [credential])
    const response = authenticator.createAuthenticationResponse({
      challenge,
      origin: rpConfig.origin,
      rpId: rpConfig.rpID,
      signingKey: impostor.privateKey,
    })

    const result = await verifyAuthentication(response, challenge, rpConfig, credential)

    expect(result).toEqual({ verified: false })
  })

  it('rejects an assertion signed over a different challenge', async () => {
    const authenticator = createTestAuthenticator()
    const credential = await registerCredential(authenticator)
    const { challenge } = await createAuthenticationOptions(rpConfig, [credential])
    const { challenge: otherChallenge } = await createAuthenticationOptions(rpConfig, [credential])
    const response = authenticator.createAuthenticationResponse({
      challenge: otherChallenge,
      origin: rpConfig.origin,
      rpId: rpConfig.rpID,
    })

    await expect(verifyAuthentication(response, challenge, rpConfig, credential))
      .rejects
      .toThrow(/challenge/)
  })

  it('rejects an assertion from a different origin', async () => {
    const authenticator = createTestAuthenticator()
    const credential = await registerCredential(authenticator)
    const { challenge } = await createAuthenticationOptions(rpConfig, [credential])
    const response = authenticator.createAuthenticationResponse({
      challenge,
      origin: 'https://evil.example',
      rpId: rpConfig.rpID,
    })

    await expect(verifyAuthentication(response, challenge, rpConfig, credential))
      .rejects
      .toThrow(/origin/)
  })

  it('rejects an assertion bound to a different RP ID', async () => {
    const authenticator = createTestAuthenticator()
    const credential = await registerCredential(authenticator)
    const { challenge } = await createAuthenticationOptions(rpConfig, [credential])
    const response = authenticator.createAuthenticationResponse({
      challenge,
      origin: rpConfig.origin,
      rpId: 'other.example',
    })

    await expect(verifyAuthentication(response, challenge, rpConfig, credential))
      .rejects
      .toThrow(/RP ID/)
  })

  it('rejects when user verification is required but missing', async () => {
    const strictConfig: RPConfig = { ...rpConfig, requireUserVerification: true }
    const authenticator = createTestAuthenticator()
    const credential = await registerCredential(authenticator, strictConfig)
    const { challenge } = await createAuthenticationOptions(strictConfig, [credential])
    const response = authenticator.createAuthenticationResponse({
      challenge,
      origin: strictConfig.origin,
      rpId: strictConfig.rpID,
      userVerified: false,
    })

    await expect(verifyAuthentication(response, challenge, strictConfig, credential))
      .rejects
      .toThrow(/[Uu]ser verification/)
  })
})
