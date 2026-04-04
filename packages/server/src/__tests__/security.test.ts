import type { Server } from 'node:http'
import { createServer } from 'node:http'
import { generateKeyPairSync, sign } from 'node:crypto'
import { toNodeListener } from 'h3'
import { generateCodeChallenge, generateCodeVerifier } from '@openape/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createIdPApp } from '../idp/app.js'
import type { IdPStores } from '../idp/config.js'

// --- Test helpers ---

function generateEd25519SshKey(): { publicKey: string, privateKey: import('node:crypto').KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const rawPub = publicKey.export({ type: 'spki', format: 'der' })
  const rawKey = rawPub.subarray(12)

  const typeStr = 'ssh-ed25519'
  const typeBuf = Buffer.from(typeStr)
  const typeLen = Buffer.alloc(4)
  typeLen.writeUInt32BE(typeBuf.length)
  const keyLen = Buffer.alloc(4)
  keyLen.writeUInt32BE(rawKey.length)
  const wireFormat = Buffer.concat([typeLen, typeBuf, keyLen, rawKey])

  return {
    publicKey: `ssh-ed25519 ${wireFormat.toString('base64')}`,
    privateKey,
  }
}

function signChallenge(challenge: string, privateKey: import('node:crypto').KeyObject): string {
  const sig = sign(null, Buffer.from(challenge), privateKey)
  return sig.toString('base64')
}

// =========================================================================
// Security Headers
// =========================================================================

describe('security headers', () => {
  let server: Server
  let baseUrl: string
  const MGMT_TOKEN = 'sec-test-mgmt-token'
  const userKey = generateEd25519SshKey()

  beforeAll(async () => {
    const instance = createIdPApp({
      issuer: 'http://localhost:0',
      managementToken: MGMT_TOKEN,
    })
    server = createServer(toNodeListener(instance.app))
    await new Promise<void>(resolve => server.listen(0, resolve))
    const addr = server.address() as { port: number }
    baseUrl = `http://localhost:${addr.port}`

    // Seed a user for auth tests
    await instance.stores.userStore.create({
      email: 'user@example.com',
      name: 'User',
      isActive: true,
      createdAt: Date.now(),
    })
    await instance.stores.sshKeyStore.save({
      keyId: 'sec-user-key',
      userEmail: 'user@example.com',
      publicKey: userKey.publicKey,
      name: 'User Key',
      createdAt: Math.floor(Date.now() / 1000),
    })
  })

  afterAll(() => { server.close() })

  it('sets security headers on API responses', async () => {
    const res = await fetch(`${baseUrl}/api/auth/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'user@example.com' }),
    })
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('content-security-policy')).toBe('frame-ancestors \'none\'')
    expect(res.headers.get('x-xss-protection')).toBe('0')
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
  })

  it('sets no-store cache-control on auth responses', async () => {
    const res = await fetch(`${baseUrl}/api/auth/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'user@example.com' }),
    })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('sets cacheable cache-control on JWKS', async () => {
    const res = await fetch(`${baseUrl}/.well-known/jwks.json`)
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600')
  })

  it('sets cacheable cache-control on discovery', async () => {
    const res = await fetch(`${baseUrl}/.well-known/openid-configuration`)
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600')
  })

  it('includes security headers even on error responses', async () => {
    const res = await fetch(`${baseUrl}/api/auth/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
  })
})

// =========================================================================
// Rate Limiting
// =========================================================================

describe('rate limiting', () => {
  let server: Server
  let baseUrl: string
  let stores: IdPStores
  const MGMT_TOKEN = 'ratelimit-mgmt-token'
  const userKey = generateEd25519SshKey()

  beforeAll(async () => {
    const instance = createIdPApp(
      {
        issuer: 'http://localhost:0',
        managementToken: MGMT_TOKEN,
        rateLimitConfig: {
          maxRequests: 3,
          windowMs: 2000,
        },
      },
    )
    stores = instance.stores
    server = createServer(toNodeListener(instance.app))
    await new Promise<void>(resolve => server.listen(0, resolve))
    const addr = server.address() as { port: number }
    baseUrl = `http://localhost:${addr.port}`

    // Seed a user
    await stores.userStore.create({
      email: 'rl-user@example.com',
      name: 'RL User',
      isActive: true,
      createdAt: Date.now(),
    })
    await stores.sshKeyStore.save({
      keyId: 'rl-user-key',
      userEmail: 'rl-user@example.com',
      publicKey: userKey.publicKey,
      name: 'RL Key',
      createdAt: Math.floor(Date.now() / 1000),
    })
  })

  afterAll(() => { server.close() })

  it('allows requests within the rate limit', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${baseUrl}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'rl-user@example.com' }),
      })
      expect(res.status).toBe(200)
    }
  })

  it('returns 429 when rate limit is exceeded', async () => {
    // Make requests until we exceed the limit (3 allowed)
    // The previous test already consumed 3, but the window may have shifted.
    // Make 4 requests — the 4th should fail.
    for (let i = 0; i < 3; i++) {
      await fetch(`${baseUrl}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'rl-user@example.com' }),
      })
    }
    const res = await fetch(`${baseUrl}/api/auth/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'rl-user@example.com' }),
    })
    expect(res.status).toBe(429)
  })

  it('includes rate limit headers', async () => {
    // Wait for window to reset
    await new Promise(resolve => setTimeout(resolve, 2100))

    const res = await fetch(`${baseUrl}/api/auth/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'rl-user@example.com' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('x-ratelimit-limit')).toBe('3')
    expect(res.headers.get('x-ratelimit-remaining')).toBeDefined()
    expect(res.headers.get('x-ratelimit-reset')).toBeDefined()
  })

  it('does not rate-limit non-protected paths', async () => {
    // Wait for window to reset
    await new Promise(resolve => setTimeout(resolve, 2100))

    // JWKS is not rate-limited
    for (let i = 0; i < 10; i++) {
      const res = await fetch(`${baseUrl}/.well-known/jwks.json`)
      expect(res.status).toBe(200)
    }
  })

  it('resets after the time window', async () => {
    // Wait for window reset
    await new Promise(resolve => setTimeout(resolve, 2100))

    // All 3 should succeed again
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${baseUrl}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'rl-user@example.com' }),
      })
      expect(res.status).toBe(200)
    }
  })
})

// =========================================================================
// Timing-Safe Management Token
// =========================================================================

describe('management token', () => {
  let server: Server
  let baseUrl: string
  const MGMT_TOKEN = 'timing-safe-mgmt-token-12345'

  beforeAll(async () => {
    const instance = createIdPApp({
      issuer: 'http://localhost:0',
      managementToken: MGMT_TOKEN,
    })
    server = createServer(toNodeListener(instance.app))
    await new Promise<void>(resolve => server.listen(0, resolve))
    const addr = server.address() as { port: number }
    baseUrl = `http://localhost:${addr.port}`
  })

  afterAll(() => { server.close() })

  it('accepts correct management token', async () => {
    const res = await fetch(`${baseUrl}/api/admin/users`, {
      headers: { Authorization: `Bearer ${MGMT_TOKEN}` },
    })
    expect(res.status).toBe(200)
  })

  it('rejects wrong management token', async () => {
    const res = await fetch(`${baseUrl}/api/admin/users`, {
      headers: { Authorization: 'Bearer wrong-token' },
    })
    expect(res.status).toBe(403)
  })

  it('rejects missing authorization header', async () => {
    const res = await fetch(`${baseUrl}/api/admin/users`)
    expect(res.status).toBe(401)
  })
})

// =========================================================================
// Input Validation / Body Limits
// =========================================================================

describe('input validation', () => {
  let server: Server
  let baseUrl: string
  const MGMT_TOKEN = 'input-val-mgmt-token'

  beforeAll(async () => {
    const instance = createIdPApp({
      issuer: 'http://localhost:0',
      managementToken: MGMT_TOKEN,
    })
    server = createServer(toNodeListener(instance.app))
    await new Promise<void>(resolve => server.listen(0, resolve))
    const addr = server.address() as { port: number }
    baseUrl = `http://localhost:${addr.port}`
  })

  afterAll(() => { server.close() })

  it('rejects oversized Content-Length', async () => {
    const largeBody = 'x'.repeat(200_000)
    const res = await fetch(`${baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': largeBody.length.toString(),
        'Authorization': `Bearer ${MGMT_TOKEN}`,
      },
      body: largeBody,
    })
    expect(res.status).toBe(413)
  })

  it('rejects email exceeding 255 characters in admin create', async () => {
    const longEmail = `${'a'.repeat(250)}@x.com`
    const res = await fetch(`${baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MGMT_TOKEN}`,
      },
      body: JSON.stringify({ email: longEmail, name: 'Test' }),
    })
    expect(res.status).toBe(400)
    const data = await res.json() as { statusMessage: string, data: { title: string } }
    expect(data.data.title).toContain('255')
  })

  it('rejects name exceeding 255 characters in admin create', async () => {
    const longName = 'a'.repeat(256)
    const res = await fetch(`${baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MGMT_TOKEN}`,
      },
      body: JSON.stringify({ email: 'ok@example.com', name: longName }),
    })
    expect(res.status).toBe(400)
    const data = await res.json() as { statusMessage: string, data: { title: string } }
    expect(data.data.title).toContain('255')
  })

  it('accepts normal-sized input', async () => {
    const res = await fetch(`${baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MGMT_TOKEN}`,
      },
      body: JSON.stringify({ email: 'valid@example.com', name: 'Valid User' }),
    })
    expect(res.status).toBe(200)
  })
})

// =========================================================================
// Code Replay Protection (authorization_code single-use)
// =========================================================================

describe('code replay protection', () => {
  let server: Server
  let baseUrl: string
  let stores: IdPStores
  const MGMT_TOKEN = 'replay-mgmt-token'
  const userKey = generateEd25519SshKey()

  beforeAll(async () => {
    const instance = createIdPApp({
      issuer: 'http://localhost:0',
      managementToken: MGMT_TOKEN,
    })
    stores = instance.stores
    server = createServer(toNodeListener(instance.app))
    await new Promise<void>(resolve => server.listen(0, resolve))
    const addr = server.address() as { port: number }
    baseUrl = `http://localhost:${addr.port}`

    // Seed user
    await stores.userStore.create({
      email: 'replay@example.com',
      name: 'Replay User',
      isActive: true,
      createdAt: Date.now(),
    })
    await stores.sshKeyStore.save({
      keyId: 'replay-key',
      userEmail: 'replay@example.com',
      publicKey: userKey.publicKey,
      name: 'Replay Key',
      createdAt: Math.floor(Date.now() / 1000),
    })
  })

  afterAll(() => { server.close() })

  async function getAuthToken(): Promise<string> {
    const challengeRes = await fetch(`${baseUrl}/api/auth/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'replay@example.com' }),
    })
    const { challenge } = await challengeRes.json() as { challenge: string }
    const signature = signChallenge(challenge, userKey.privateKey)
    const authRes = await fetch(`${baseUrl}/api/auth/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'replay@example.com', challenge, signature }),
    })
    const data = await authRes.json() as { token: string }
    return data.token
  }

  async function getAuthCode(token: string): Promise<{ code: string, codeVerifier: string }> {
    const codeVerifier = generateCodeVerifier()
    const codeChallenge = await generateCodeChallenge(codeVerifier)

    const authorizeRes = await fetch(
      `${baseUrl}/authorize?response_type=code&client_id=sp.example.com&redirect_uri=${encodeURIComponent('http://sp.example.com/callback')}&state=s&code_challenge=${codeChallenge}&code_challenge_method=S256`,
      { headers: { Authorization: `Bearer ${token}` }, redirect: 'manual' },
    )
    expect(authorizeRes.status).toBe(302)
    const location = authorizeRes.headers.get('location')!
    const code = new URL(location).searchParams.get('code')!
    return { code, codeVerifier }
  }

  it('rejects second exchange of the same authorization code', async () => {
    const token = await getAuthToken()
    const { code, codeVerifier } = await getAuthCode(token)

    // First exchange — should succeed
    const firstRes = await fetch(`${baseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        redirect_uri: 'http://sp.example.com/callback',
        client_id: 'sp.example.com',
      }),
    })
    expect(firstRes.status).toBe(200)

    // Second exchange — should fail (code consumed)
    const secondRes = await fetch(`${baseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        redirect_uri: 'http://sp.example.com/callback',
        client_id: 'sp.example.com',
      }),
    })
    const data = await secondRes.json() as { error: string }
    expect(data.error).toBe('invalid_grant')
  })
})

// =========================================================================
// PKCE Code Single-Use
// =========================================================================

describe('PKCE code single-use', () => {
  let server: Server
  let baseUrl: string
  let stores: IdPStores
  const MGMT_TOKEN = 'pkce-mgmt-token'
  const userKey = generateEd25519SshKey()

  beforeAll(async () => {
    const instance = createIdPApp({
      issuer: 'http://localhost:0',
      managementToken: MGMT_TOKEN,
    })
    stores = instance.stores
    server = createServer(toNodeListener(instance.app))
    await new Promise<void>(resolve => server.listen(0, resolve))
    const addr = server.address() as { port: number }
    baseUrl = `http://localhost:${addr.port}`

    // Seed user
    await stores.userStore.create({
      email: 'pkce@example.com',
      name: 'PKCE User',
      isActive: true,
      createdAt: Date.now(),
    })
    await stores.sshKeyStore.save({
      keyId: 'pkce-key',
      userEmail: 'pkce@example.com',
      publicKey: userKey.publicKey,
      name: 'PKCE Key',
      createdAt: Math.floor(Date.now() / 1000),
    })
  })

  afterAll(() => { server.close() })

  async function getAuthToken(): Promise<string> {
    const challengeRes = await fetch(`${baseUrl}/api/auth/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'pkce@example.com' }),
    })
    const { challenge } = await challengeRes.json() as { challenge: string }
    const signature = signChallenge(challenge, userKey.privateKey)
    const authRes = await fetch(`${baseUrl}/api/auth/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'pkce@example.com', challenge, signature }),
    })
    const data = await authRes.json() as { token: string }
    return data.token
  }

  it('rejects code reuse with PKCE flow', async () => {
    const token = await getAuthToken()
    const codeVerifier = generateCodeVerifier()
    const codeChallenge = await generateCodeChallenge(codeVerifier)

    // Get authorization code with PKCE
    const authorizeRes = await fetch(
      `${baseUrl}/authorize?response_type=code&client_id=sp.example.com&redirect_uri=${encodeURIComponent('http://sp.example.com/callback')}&state=pkce-state&code_challenge=${codeChallenge}&code_challenge_method=S256&scope=openid`,
      { headers: { Authorization: `Bearer ${token}` }, redirect: 'manual' },
    )
    expect(authorizeRes.status).toBe(302)
    const location = authorizeRes.headers.get('location')!
    const code = new URL(location).searchParams.get('code')!

    // First exchange with correct PKCE verifier — should succeed
    const firstRes = await fetch(`${baseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        redirect_uri: 'http://sp.example.com/callback',
        client_id: 'sp.example.com',
      }),
    })
    expect(firstRes.status).toBe(200)
    const tokenData = await firstRes.json() as { access_token: string, id_token: string }
    expect(tokenData.access_token).toBeDefined()
    expect(tokenData.id_token).toBeDefined()

    // Second exchange with same code — should fail
    const secondRes = await fetch(`${baseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        redirect_uri: 'http://sp.example.com/callback',
        client_id: 'sp.example.com',
      }),
    })
    const errorData = await secondRes.json() as { error: string }
    expect(errorData.error).toBe('invalid_grant')
  })

  it('rejects wrong PKCE verifier', async () => {
    const token = await getAuthToken()
    const codeVerifier = generateCodeVerifier()
    const codeChallenge = await generateCodeChallenge(codeVerifier)

    const authorizeRes = await fetch(
      `${baseUrl}/authorize?response_type=code&client_id=sp.example.com&redirect_uri=${encodeURIComponent('http://sp.example.com/callback')}&state=pkce2&code_challenge=${codeChallenge}&code_challenge_method=S256`,
      { headers: { Authorization: `Bearer ${token}` }, redirect: 'manual' },
    )
    const code = new URL(authorizeRes.headers.get('location')!).searchParams.get('code')!

    // Exchange with wrong verifier
    const res = await fetch(`${baseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        code_verifier: 'wrong-verifier-that-does-not-match-challenge',
        redirect_uri: 'http://sp.example.com/callback',
        client_id: 'sp.example.com',
      }),
    })
    const data = await res.json() as { error: string }
    expect(data.error).toBe('invalid_grant')
  })
})
