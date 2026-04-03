import { generateKeyPair, signJWT } from '@openape/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleCallback } from '../sp/callback.js'

const IDP_URL = 'https://idp.example.com'
const CLIENT_ID = 'sp.example.com'
const REDIRECT_URI = 'https://sp.example.com/callback'
const STATE = 'random-state'
const NONCE = 'random-nonce'
const USER_SUB = 'alice@example.com'

describe('handleCallback', () => {
  let publicKey: CryptoKey
  let privateKey: CryptoKey

  beforeEach(async () => {
    const kp = await generateKeyPair()
    publicKey = kp.publicKey as CryptoKey
    privateKey = kp.privateKey as CryptoKey
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function makeFlowState() {
    return {
      codeVerifier: 'test-verifier',
      state: STATE,
      nonce: NONCE,
      idpUrl: IDP_URL,
      createdAt: Date.now(),
    }
  }

  async function signAssertion(overrides: Record<string, unknown> = {}) {
    const now = Math.floor(Date.now() / 1000)
    return signJWT(
      {
        iss: IDP_URL,
        sub: USER_SUB,
        aud: CLIENT_ID,
        act: 'human',
        iat: now,
        exp: now + 300,
        jti: crypto.randomUUID(),
        nonce: NONCE,
        ...overrides,
      },
      privateKey,
      { kid: 'key-1' },
    )
  }

  it('exchanges code and validates assertion (happy path)', async () => {
    const assertion = await signAssertion()

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ assertion }), { status: 200 }),
    ))

    const result = await handleCallback({
      code: 'auth-code',
      state: STATE,
      flowState: makeFlowState(),
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      publicKey,
    })

    expect(result.claims.sub).toBe(USER_SUB)
    expect(result.claims.iss).toBe(IDP_URL)
    expect(result.rawAssertion).toBe(assertion)
  })

  it('returns authorization_details when present in token response', async () => {
    const assertion = await signAssertion()
    const details = [{ type: 'openape_grant', action: 'Transfer:Create', approval: 'once', grant_id: 'g1' }]

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ assertion, authorization_details: details }), { status: 200 }),
    ))

    const result = await handleCallback({
      code: 'auth-code',
      state: STATE,
      flowState: makeFlowState(),
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      publicKey,
    })

    expect(result.authorizationDetails).toEqual(details)
  })

  it('throws on state mismatch', async () => {
    await expect(handleCallback({
      code: 'auth-code',
      state: 'wrong-state',
      flowState: makeFlowState(),
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      publicKey,
    })).rejects.toThrow('State mismatch')
  })

  it('throws on token exchange HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('bad request', { status: 400 }),
    ))

    await expect(handleCallback({
      code: 'auth-code',
      state: STATE,
      flowState: makeFlowState(),
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      publicKey,
    })).rejects.toThrow('Token exchange failed: 400')
  })

  it('throws on invalid assertion (wrong issuer)', async () => {
    const assertion = await signAssertion({ iss: 'https://evil.example.com' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ assertion }), { status: 200 }),
    ))

    await expect(handleCallback({
      code: 'auth-code',
      state: STATE,
      flowState: makeFlowState(),
      clientId: CLIENT_ID,
      redirectUri: REDIRECT_URI,
      publicKey,
    })).rejects.toThrow('Assertion validation failed')
  })
})
