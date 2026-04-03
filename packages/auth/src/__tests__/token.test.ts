import type { DDISADelegateClaim, OpenApeAuthorizationDetail } from '@openape/core'
import { generateCodeChallenge, generateCodeVerifier, verifyJWT } from '@openape/core'
import { describe, expect, it } from 'vitest'
import { InMemoryCodeStore, InMemoryKeyStore } from '../idp/stores.js'
import { handleTokenExchange, issueAssertion } from '../idp/token.js'

describe('handleTokenExchange', () => {
  it('exchanges a valid code for OIDC token response', async () => {
    const codeStore = new InMemoryCodeStore()
    const keyStore = new InMemoryKeyStore()
    const verifier = generateCodeVerifier()
    const challenge = await generateCodeChallenge(verifier)

    await codeStore.save({
      code: 'test-code',
      clientId: 'sp.example.com',
      redirectUri: 'https://sp.example.com/callback',
      codeChallenge: challenge,
      userId: 'alice@example.com',
      nonce: 'test-nonce',
      expiresAt: Date.now() + 60000,
    })

    const result = await handleTokenExchange(
      {
        grant_type: 'authorization_code',
        code: 'test-code',
        code_verifier: verifier,
        redirect_uri: 'https://sp.example.com/callback',
        client_id: 'sp.example.com',
      },
      codeStore,
      keyStore,
      'https://idp.example.com',
    )

    // OIDC response format
    expect(result.id_token).toBeTruthy()
    expect(result.access_token).toBeTruthy()
    expect(result.token_type).toBe('Bearer')
    expect(result.expires_in).toBe(300)

    // Backwards compatibility
    expect(result.assertion).toBeTruthy()
    expect(result.assertion).toBe(result.id_token)

    // Verify the JWT contents
    const key = await keyStore.getSigningKey()
    const { payload } = await verifyJWT(result.id_token, key.publicKey)
    expect(payload.iss).toBe('https://idp.example.com')
    expect(payload.sub).toBe('alice@example.com')
    expect(payload.aud).toBe('sp.example.com')
    expect(payload.act).toBe('human')
    expect(payload.nonce).toBe('test-nonce')
  })

  it('includes kid in JWT header', async () => {
    const codeStore = new InMemoryCodeStore()
    const keyStore = new InMemoryKeyStore()
    const verifier = generateCodeVerifier()
    const challenge = await generateCodeChallenge(verifier)

    await codeStore.save({
      code: 'kid-code',
      clientId: 'sp.example.com',
      redirectUri: 'https://sp.example.com/callback',
      codeChallenge: challenge,
      userId: 'alice@example.com',
      nonce: 'n',
      expiresAt: Date.now() + 60000,
    })

    const result = await handleTokenExchange(
      {
        grant_type: 'authorization_code',
        code: 'kid-code',
        code_verifier: verifier,
        redirect_uri: 'https://sp.example.com/callback',
        client_id: 'sp.example.com',
      },
      codeStore,
      keyStore,
      'https://idp.example.com',
    )

    const key = await keyStore.getSigningKey()
    const { protectedHeader } = await verifyJWT(result.id_token, key.publicKey)
    expect(protectedHeader.kid).toBe(key.kid)
    expect(protectedHeader.alg).toBe('EdDSA')
  })

  it('rejects invalid code', async () => {
    const codeStore = new InMemoryCodeStore()
    const keyStore = new InMemoryKeyStore()

    await expect(handleTokenExchange(
      {
        grant_type: 'authorization_code',
        code: 'invalid',
        code_verifier: 'v',
        redirect_uri: 'https://sp/cb',
        client_id: 'sp',
      },
      codeStore,
      keyStore,
      'https://idp',
    )).rejects.toThrow('Invalid or expired')
  })

  it('rejects expired code', async () => {
    const codeStore = new InMemoryCodeStore()
    const keyStore = new InMemoryKeyStore()
    const verifier = generateCodeVerifier()
    const challenge = await generateCodeChallenge(verifier)

    await codeStore.save({
      code: 'expired-code',
      clientId: 'sp.example.com',
      redirectUri: 'https://sp.example.com/callback',
      codeChallenge: challenge,
      userId: 'alice@example.com',
      nonce: 'n',
      expiresAt: Date.now() - 1000, // already expired
    })

    await expect(handleTokenExchange(
      {
        grant_type: 'authorization_code',
        code: 'expired-code',
        code_verifier: verifier,
        redirect_uri: 'https://sp.example.com/callback',
        client_id: 'sp.example.com',
      },
      codeStore,
      keyStore,
      'https://idp.example.com',
    )).rejects.toThrow('Invalid or expired')
  })

  it('rejects unsupported grant_type', async () => {
    const codeStore = new InMemoryCodeStore()
    const keyStore = new InMemoryKeyStore()

    await expect(handleTokenExchange(
      {
        grant_type: 'client_credentials',
        code: 'test',
        code_verifier: 'v',
        redirect_uri: 'https://sp/cb',
        client_id: 'sp',
      },
      codeStore,
      keyStore,
      'https://idp',
    )).rejects.toThrow('Unsupported grant_type')
  })

  it('rejects client_id mismatch', async () => {
    const codeStore = new InMemoryCodeStore()
    const keyStore = new InMemoryKeyStore()
    const verifier = generateCodeVerifier()
    const challenge = await generateCodeChallenge(verifier)

    await codeStore.save({
      code: 'test-code',
      clientId: 'sp.example.com',
      redirectUri: 'https://sp.example.com/callback',
      codeChallenge: challenge,
      userId: 'alice@example.com',
      nonce: 'n',
      expiresAt: Date.now() + 60000,
    })

    await expect(handleTokenExchange(
      {
        grant_type: 'authorization_code',
        code: 'test-code',
        code_verifier: verifier,
        redirect_uri: 'https://sp.example.com/callback',
        client_id: 'wrong-client',
      },
      codeStore,
      keyStore,
      'https://idp',
    )).rejects.toThrow('Client ID mismatch')
  })

  it('rejects redirect_uri mismatch', async () => {
    const codeStore = new InMemoryCodeStore()
    const keyStore = new InMemoryKeyStore()
    const verifier = generateCodeVerifier()
    const challenge = await generateCodeChallenge(verifier)

    await codeStore.save({
      code: 'test-code',
      clientId: 'sp.example.com',
      redirectUri: 'https://sp.example.com/callback',
      codeChallenge: challenge,
      userId: 'alice@example.com',
      nonce: 'n',
      expiresAt: Date.now() + 60000,
    })

    await expect(handleTokenExchange(
      {
        grant_type: 'authorization_code',
        code: 'test-code',
        code_verifier: verifier,
        redirect_uri: 'https://wrong.example.com/callback',
        client_id: 'sp.example.com',
      },
      codeStore,
      keyStore,
      'https://idp',
    )).rejects.toThrow('Redirect URI mismatch')
  })

  it('rejects wrong PKCE verifier', async () => {
    const codeStore = new InMemoryCodeStore()
    const keyStore = new InMemoryKeyStore()
    const verifier = generateCodeVerifier()
    const challenge = await generateCodeChallenge(verifier)

    await codeStore.save({
      code: 'test-code',
      clientId: 'sp',
      redirectUri: 'https://sp/cb',
      codeChallenge: challenge,
      userId: 'alice@example.com',
      nonce: 'n',
      expiresAt: Date.now() + 60000,
    })

    await expect(handleTokenExchange(
      {
        grant_type: 'authorization_code',
        code: 'test-code',
        code_verifier: 'wrong-verifier',
        redirect_uri: 'https://sp/cb',
        client_id: 'sp',
      },
      codeStore,
      keyStore,
      'https://idp',
    )).rejects.toThrow('PKCE')
  })

  it('includes delegate claim in assertion when code entry has delegate', async () => {
    const codeStore = new InMemoryCodeStore()
    const keyStore = new InMemoryKeyStore()
    const verifier = generateCodeVerifier()
    const challenge = await generateCodeChallenge(verifier)

    const delegate: DDISADelegateClaim = {
      sub: 'agent@idp.example.com',
      act: 'agent',
      grant_id: 'grant-123',
    }

    await codeStore.save({
      code: 'delegate-code',
      clientId: 'sp.example.com',
      redirectUri: 'https://sp.example.com/callback',
      codeChallenge: challenge,
      userId: 'alice@example.com',
      nonce: 'delegate-nonce',
      expiresAt: Date.now() + 60000,
      delegate,
    })

    const result = await handleTokenExchange(
      {
        grant_type: 'authorization_code',
        code: 'delegate-code',
        code_verifier: verifier,
        redirect_uri: 'https://sp.example.com/callback',
        client_id: 'sp.example.com',
      },
      codeStore,
      keyStore,
      'https://idp.example.com',
    )

    const key = await keyStore.getSigningKey()
    const { payload } = await verifyJWT(result.assertion, key.publicKey)
    expect(payload.sub).toBe('alice@example.com')
    expect(payload.act).toBe('human')
    expect(payload.delegate).toEqual(delegate)
  })

  it('resolves user claims based on scope via callback', async () => {
    const codeStore = new InMemoryCodeStore()
    const keyStore = new InMemoryKeyStore()
    const verifier = generateCodeVerifier()
    const challenge = await generateCodeChallenge(verifier)

    await codeStore.save({
      code: 'scope-code',
      clientId: 'sp.example.com',
      redirectUri: 'https://sp.example.com/callback',
      codeChallenge: challenge,
      userId: 'alice@example.com',
      nonce: 'n',
      expiresAt: Date.now() + 60000,
      scope: 'openid email profile',
    })

    const result = await handleTokenExchange(
      {
        grant_type: 'authorization_code',
        code: 'scope-code',
        code_verifier: verifier,
        redirect_uri: 'https://sp.example.com/callback',
        client_id: 'sp.example.com',
      },
      codeStore,
      keyStore,
      'https://idp.example.com',
      async (userId, scope) => {
        expect(userId).toBe('alice@example.com')
        expect(scope).toBe('openid email profile')
        return { email: 'alice@example.com', name: 'Alice' }
      },
    )

    const key = await keyStore.getSigningKey()
    const { payload } = await verifyJWT(result.id_token, key.publicKey)
    expect(payload.email).toBe('alice@example.com')
    expect(payload.name).toBe('Alice')
  })

  it('does not include email/name without resolver', async () => {
    const codeStore = new InMemoryCodeStore()
    const keyStore = new InMemoryKeyStore()
    const verifier = generateCodeVerifier()
    const challenge = await generateCodeChallenge(verifier)

    await codeStore.save({
      code: 'no-scope-code',
      clientId: 'sp.example.com',
      redirectUri: 'https://sp.example.com/callback',
      codeChallenge: challenge,
      userId: 'alice@example.com',
      nonce: 'n',
      expiresAt: Date.now() + 60000,
    })

    const result = await handleTokenExchange(
      {
        grant_type: 'authorization_code',
        code: 'no-scope-code',
        code_verifier: verifier,
        redirect_uri: 'https://sp.example.com/callback',
        client_id: 'sp.example.com',
      },
      codeStore,
      keyStore,
      'https://idp.example.com',
    )

    const key = await keyStore.getSigningKey()
    const { payload } = await verifyJWT(result.id_token, key.publicKey)
    expect(payload.email).toBeUndefined()
    expect(payload.name).toBeUndefined()
  })
})

describe('authorization_details (RFC 9396)', () => {
  it('includes authorization_details in token response when present in code entry', async () => {
    const codeStore = new InMemoryCodeStore()
    const keyStore = new InMemoryKeyStore()
    const verifier = generateCodeVerifier()
    const challenge = await generateCodeChallenge(verifier)

    const details: OpenApeAuthorizationDetail[] = [
      { type: 'openape_grant', action: 'Transfer:Create', approval: 'once', grant_id: 'grant-abc' },
    ]

    await codeStore.save({
      code: 'authz-code',
      clientId: 'sp.example.com',
      redirectUri: 'https://sp.example.com/callback',
      codeChallenge: challenge,
      userId: 'alice@example.com',
      nonce: 'n',
      expiresAt: Date.now() + 60000,
      authorizationDetails: details,
    })

    const result = await handleTokenExchange(
      {
        grant_type: 'authorization_code',
        code: 'authz-code',
        code_verifier: verifier,
        redirect_uri: 'https://sp.example.com/callback',
        client_id: 'sp.example.com',
      },
      codeStore,
      keyStore,
      'https://idp.example.com',
    )

    // Token response includes authorization_details
    expect(result.authorization_details).toEqual(details)

    // JWT also includes authorization_details claim
    const key = await keyStore.getSigningKey()
    const { payload } = await verifyJWT(result.id_token, key.publicKey)
    expect(payload.authorization_details).toEqual(details)
  })

  it('omits authorization_details from response when not present in code entry', async () => {
    const codeStore = new InMemoryCodeStore()
    const keyStore = new InMemoryKeyStore()
    const verifier = generateCodeVerifier()
    const challenge = await generateCodeChallenge(verifier)

    await codeStore.save({
      code: 'no-authz-code',
      clientId: 'sp.example.com',
      redirectUri: 'https://sp.example.com/callback',
      codeChallenge: challenge,
      userId: 'alice@example.com',
      nonce: 'n',
      expiresAt: Date.now() + 60000,
    })

    const result = await handleTokenExchange(
      {
        grant_type: 'authorization_code',
        code: 'no-authz-code',
        code_verifier: verifier,
        redirect_uri: 'https://sp.example.com/callback',
        client_id: 'sp.example.com',
      },
      codeStore,
      keyStore,
      'https://idp.example.com',
    )

    expect(result.authorization_details).toBeUndefined()

    const key = await keyStore.getSigningKey()
    const { payload } = await verifyJWT(result.id_token, key.publicKey)
    expect(payload.authorization_details).toBeUndefined()
  })

})

describe('issueAssertion', () => {
  it('issues assertion without delegate by default', async () => {
    const keyStore = new InMemoryKeyStore()

    const assertion = await issueAssertion(
      { sub: 'alice@example.com', aud: 'sp.example.com', nonce: 'n' },
      keyStore,
      'https://idp.example.com',
    )

    const key = await keyStore.getSigningKey()
    const { payload } = await verifyJWT(assertion, key.publicKey)
    expect(payload.act).toBe('human')
    expect(payload.delegate).toBeUndefined()
  })

  it('includes delegate claim when provided', async () => {
    const keyStore = new InMemoryKeyStore()
    const delegate: DDISADelegateClaim = {
      sub: 'agent@idp.example.com',
      act: 'agent',
      grant_id: 'grant-456',
    }

    const assertion = await issueAssertion(
      { sub: 'alice@example.com', aud: 'sp.example.com', nonce: 'n', delegate },
      keyStore,
      'https://idp.example.com',
    )

    const key = await keyStore.getSigningKey()
    const { payload } = await verifyJWT(assertion, key.publicKey)
    expect(payload.sub).toBe('alice@example.com')
    expect(payload.act).toBe('human')
    expect(payload.delegate).toEqual(delegate)
  })

  it('includes email and name when provided', async () => {
    const keyStore = new InMemoryKeyStore()

    const assertion = await issueAssertion(
      { sub: 'alice@example.com', aud: 'sp.example.com', nonce: 'n', email: 'alice@example.com', name: 'Alice' },
      keyStore,
      'https://idp.example.com',
    )

    const key = await keyStore.getSigningKey()
    const { payload } = await verifyJWT(assertion, key.publicKey)
    expect(payload.email).toBe('alice@example.com')
    expect(payload.name).toBe('Alice')
  })

  it('includes kid in JWT header', async () => {
    const keyStore = new InMemoryKeyStore()

    const assertion = await issueAssertion(
      { sub: 'alice@example.com', aud: 'sp.example.com', nonce: 'n' },
      keyStore,
      'https://idp.example.com',
    )

    const key = await keyStore.getSigningKey()
    const { protectedHeader } = await verifyJWT(assertion, key.publicKey)
    expect(protectedHeader.kid).toBe(key.kid)
  })

  it('includes authorization_details claim when provided', async () => {
    const keyStore = new InMemoryKeyStore()
    const details: OpenApeAuthorizationDetail[] = [
      { type: 'openape_grant', action: 'Transfer:Create', approval: 'once', grant_id: 'g1' },
    ]

    const assertion = await issueAssertion(
      { sub: 'alice@example.com', aud: 'sp.example.com', nonce: 'n', authorization_details: details },
      keyStore,
      'https://idp.example.com',
    )

    const key = await keyStore.getSigningKey()
    const { payload } = await verifyJWT(assertion, key.publicKey)
    expect(payload.authorization_details).toEqual(details)
  })

  it('omits authorization_details from JWT when not provided', async () => {
    const keyStore = new InMemoryKeyStore()

    const assertion = await issueAssertion(
      { sub: 'alice@example.com', aud: 'sp.example.com', nonce: 'n' },
      keyStore,
      'https://idp.example.com',
    )

    const key = await keyStore.getSigningKey()
    const { payload } = await verifyJWT(assertion, key.publicKey)
    expect(payload.authorization_details).toBeUndefined()
  })

  it('issues delegation token with act claim (rfc 8693)', async () => {
    const keyStore = new InMemoryKeyStore()

    const assertion = await issueAssertion(
      {
        sub: 'patrick@hofmann.eco',
        aud: 'bank.example.com',
        nonce: 'n',
        delegation_act: { sub: 'agent+patrick@id.openape.at' },
        delegation_grant: 'del-abc123',
      },
      keyStore,
      'https://idp.example.com',
    )

    const key = await keyStore.getSigningKey()
    const { payload } = await verifyJWT(assertion, key.publicKey)
    expect(payload.sub).toBe('patrick@hofmann.eco')
    expect(payload.act).toEqual({ sub: 'agent+patrick@id.openape.at' })
    expect(payload.delegation_grant).toBe('del-abc123')
  })

  it('delegation_act overrides act field', async () => {
    const keyStore = new InMemoryKeyStore()

    const assertion = await issueAssertion(
      {
        sub: 'patrick@hofmann.eco',
        aud: 'sp.example.com',
        nonce: 'n',
        act: 'agent',
        delegation_act: { sub: 'lisa@firma.at' },
        delegation_grant: 'del-xyz',
      },
      keyStore,
      'https://idp.example.com',
    )

    const key = await keyStore.getSigningKey()
    const { payload } = await verifyJWT(assertion, key.publicKey)
    expect(payload.act).toEqual({ sub: 'lisa@firma.at' })
  })

  it('omits delegation_grant when not provided', async () => {
    const keyStore = new InMemoryKeyStore()

    const assertion = await issueAssertion(
      { sub: 'alice@example.com', aud: 'sp.example.com', nonce: 'n' },
      keyStore,
      'https://idp.example.com',
    )

    const key = await keyStore.getSigningKey()
    const { payload } = await verifyJWT(assertion, key.publicKey)
    expect(payload.delegation_grant).toBeUndefined()
  })

  it('passes delegation through token exchange', async () => {
    const codeStore = new InMemoryCodeStore()
    const keyStore = new InMemoryKeyStore()
    const verifier = generateCodeVerifier()
    const challenge = await generateCodeChallenge(verifier)

    await codeStore.save({
      code: 'delegation-code',
      clientId: 'bank.example.com',
      redirectUri: 'https://bank.example.com/callback',
      codeChallenge: challenge,
      userId: 'patrick@hofmann.eco',
      nonce: 'n',
      expiresAt: Date.now() + 60000,
      delegationAct: { sub: 'agent+patrick@id.openape.at' },
      delegationGrant: 'del-abc123',
    })

    const result = await handleTokenExchange(
      {
        grant_type: 'authorization_code',
        code: 'delegation-code',
        code_verifier: verifier,
        redirect_uri: 'https://bank.example.com/callback',
        client_id: 'bank.example.com',
      },
      codeStore,
      keyStore,
      'https://idp.example.com',
    )

    const key = await keyStore.getSigningKey()
    const { payload } = await verifyJWT(result.id_token, key.publicKey)
    expect(payload.sub).toBe('patrick@hofmann.eco')
    expect(payload.act).toEqual({ sub: 'agent+patrick@id.openape.at' })
    expect(payload.delegation_grant).toBe('del-abc123')
  })
})
