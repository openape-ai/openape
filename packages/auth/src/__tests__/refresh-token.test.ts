import { generateCodeChallenge, generateCodeVerifier, verifyJWT } from '@openape/core'
import { describe, expect, it } from 'vitest'
import { handleRefreshGrant } from '../idp/refresh.js'
import { InMemoryCodeStore, InMemoryKeyStore, InMemoryRefreshTokenStore } from '../idp/stores.js'
import { handleTokenExchange } from '../idp/token.js'

describe('refresh token store', () => {
  it('creates and consumes a refresh token', async () => {
    const store = new InMemoryRefreshTokenStore()
    const { token, familyId } = await store.create('alice@example.com', 'sp.example.com')

    expect(token).toBeTruthy()
    expect(token.length).toBeGreaterThanOrEqual(48)
    expect(familyId).toBeTruthy()

    const result = await store.consume(token)
    expect(result.userId).toBe('alice@example.com')
    expect(result.clientId).toBe('sp.example.com')
    expect(result.familyId).toBe(familyId)
    expect(result.newToken).toBeTruthy()
    expect(result.newToken).not.toBe(token)
  })

  it('rejects invalid refresh token', async () => {
    const store = new InMemoryRefreshTokenStore()
    await expect(store.consume('invalid-token')).rejects.toThrow('Invalid refresh token')
  })

  it('detects token reuse and revokes family', async () => {
    const store = new InMemoryRefreshTokenStore()
    const { token } = await store.create('alice@example.com', 'sp.example.com')

    // First use succeeds
    const { newToken } = await store.consume(token)
    expect(newToken).toBeTruthy()

    // Reuse of old token → family revoked
    await expect(store.consume(token)).rejects.toThrow('reuse detected')

    // New token also fails (family is revoked)
    await expect(store.consume(newToken)).rejects.toThrow('revoked')
  })

  it('supports token rotation chain', async () => {
    const store = new InMemoryRefreshTokenStore()
    const { token: t1 } = await store.create('alice@example.com', 'sp.example.com')

    const { newToken: t2 } = await store.consume(t1)
    const { newToken: t3 } = await store.consume(t2)
    const { newToken: t4 } = await store.consume(t3)

    // t4 is valid
    const result = await store.consume(t4)
    expect(result.userId).toBe('alice@example.com')
  })

  it('revokes family', async () => {
    const store = new InMemoryRefreshTokenStore()
    const { token, familyId } = await store.create('alice@example.com', 'sp.example.com')

    await store.revokeFamily(familyId)

    await expect(store.consume(token)).rejects.toThrow('revoked')
  })

  it('revokes all families for a user', async () => {
    const store = new InMemoryRefreshTokenStore()
    const { token: t1 } = await store.create('alice@example.com', 'sp1.example.com')
    const { token: t2 } = await store.create('alice@example.com', 'sp2.example.com')
    const { token: t3 } = await store.create('bob@example.com', 'sp1.example.com')

    await store.revokeByUser('alice@example.com')

    await expect(store.consume(t1)).rejects.toThrow('revoked')
    await expect(store.consume(t2)).rejects.toThrow('revoked')

    // Bob's token still works
    const result = await store.consume(t3)
    expect(result.userId).toBe('bob@example.com')
  })

  it('revokes family via revokeByToken', async () => {
    const store = new InMemoryRefreshTokenStore()
    const { token } = await store.create('alice@example.com', 'sp.example.com')

    await store.revokeByToken(token)

    await expect(store.consume(token)).rejects.toThrow('revoked')
  })

  it('revokeByToken is a no-op for unknown token', async () => {
    const store = new InMemoryRefreshTokenStore()
    // Should not throw
    await store.revokeByToken('nonexistent-token')
  })

  it('revokeFamily is a no-op for unknown familyId', async () => {
    const store = new InMemoryRefreshTokenStore()
    // Should not throw
    await store.revokeFamily('nonexistent-family')
  })

  it('lists active families', async () => {
    const store = new InMemoryRefreshTokenStore()
    await store.create('alice@example.com', 'sp1.example.com')
    await store.create('alice@example.com', 'sp2.example.com')
    await store.create('bob@example.com', 'sp1.example.com')

    const all = await store.listFamilies()
    expect(all.data).toHaveLength(3)
    expect(all.pagination).toBeDefined()

    const alice = await store.listFamilies({ userId: 'alice@example.com' })
    expect(alice.data).toHaveLength(2)

    const bob = await store.listFamilies({ userId: 'bob@example.com' })
    expect(bob.data).toHaveLength(1)
  })

  it('listFamilies supports legacy string argument', async () => {
    const store = new InMemoryRefreshTokenStore()
    await store.create('alice@example.com', 'sp1.example.com')

    const result = await store.listFamilies('alice@example.com')
    expect(result.data).toHaveLength(1)
    expect(result.pagination).toBeDefined()
  })

  it('listFamilies excludes expired families', async () => {
    const store = new InMemoryRefreshTokenStore()
    await store.create('alice@example.com', 'sp.example.com', 1) // 1ms TTL
    await new Promise(r => setTimeout(r, 10))

    const result = await store.listFamilies()
    expect(result.data).toHaveLength(0)
  })

  it('listFamilies supports cursor pagination', async () => {
    const store = new InMemoryRefreshTokenStore()
    await store.create('alice@example.com', 'sp1.example.com')
    await store.create('alice@example.com', 'sp2.example.com')
    await store.create('alice@example.com', 'sp3.example.com')

    const page1 = await store.listFamilies({ limit: 1 })
    expect(page1.data).toHaveLength(1)
    expect(page1.pagination.has_more).toBe(true)
    expect(page1.pagination.cursor).toBeDefined()

    const page2 = await store.listFamilies({ limit: 1, cursor: page1.pagination.cursor! })
    expect(page2.data).toHaveLength(1)
    expect(page2.pagination.has_more).toBe(true)
    expect(page2.data[0].familyId).not.toBe(page1.data[0].familyId)

    const page3 = await store.listFamilies({ limit: 1, cursor: page2.pagination.cursor! })
    expect(page3.data).toHaveLength(1)
    expect(page3.pagination.has_more).toBe(false)
  })
})

describe('handleTokenExchange with offline_access', () => {
  it('includes refresh_token when scope has offline_access', async () => {
    const codeStore = new InMemoryCodeStore()
    const keyStore = new InMemoryKeyStore()
    const refreshStore = new InMemoryRefreshTokenStore()
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
      scope: 'openid offline_access',
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
      undefined,
      refreshStore,
    )

    expect(result.refresh_token).toBeTruthy()
    expect(result.id_token).toBeTruthy()
    expect(result.access_token).toBeTruthy()
  })

  it('does not include refresh_token without offline_access', async () => {
    const codeStore = new InMemoryCodeStore()
    const keyStore = new InMemoryKeyStore()
    const refreshStore = new InMemoryRefreshTokenStore()
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
      scope: 'openid email',
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
      undefined,
      refreshStore,
    )

    expect(result.refresh_token).toBeUndefined()
  })
})

describe('handleRefreshGrant', () => {
  it('rotates token and issues new access token', async () => {
    const keyStore = new InMemoryKeyStore()
    const refreshStore = new InMemoryRefreshTokenStore()
    const { token } = await refreshStore.create('alice@example.com', 'sp.example.com')

    const result = await handleRefreshGrant(
      token,
      'sp.example.com',
      refreshStore,
      keyStore,
      'https://idp.example.com',
    )

    expect(result.access_token).toBeTruthy()
    expect(result.id_token).toBeTruthy()
    expect(result.refresh_token).toBeTruthy()
    expect(result.refresh_token).not.toBe(token)
    expect(result.token_type).toBe('Bearer')
    expect(result.expires_in).toBe(300)

    // Verify the JWT
    const key = await keyStore.getSigningKey()
    const { payload } = await verifyJWT(result.id_token, key.publicKey)
    expect(payload.sub).toBe('alice@example.com')
    expect(payload.aud).toBe('sp.example.com')
    expect(payload.iss).toBe('https://idp.example.com')
  })

  it('includes user claims when resolveUserClaims is provided', async () => {
    const keyStore = new InMemoryKeyStore()
    const refreshStore = new InMemoryRefreshTokenStore()
    const { token } = await refreshStore.create('alice@example.com', 'sp.example.com')

    const result = await handleRefreshGrant(
      token,
      'sp.example.com',
      refreshStore,
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

  it('rejects expired refresh token', async () => {
    const keyStore = new InMemoryKeyStore()
    const refreshStore = new InMemoryRefreshTokenStore()
    const { token } = await refreshStore.create('alice@example.com', 'sp.example.com', 1) // 1ms TTL

    // Wait for expiry
    await new Promise(r => setTimeout(r, 10))

    await expect(handleRefreshGrant(
      token,
      'sp.example.com',
      refreshStore,
      keyStore,
      'https://idp.example.com',
    )).rejects.toThrow('expired')
  })
})
