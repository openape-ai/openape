import type { Server } from 'node:http'
import { createServer } from 'node:http'
import { generateKeyPairSync, sign } from 'node:crypto'
import { toNodeListener } from 'h3'
import { SignJWT, jwtVerify } from 'jose'
import { generateCodeChallenge, generateCodeVerifier } from '@openape/core'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
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

// --- Test suite ---

describe('delegation endpoints', () => {
  let server: Server
  let baseUrl: string
  let stores: IdPStores
  const ISSUER = 'http://localhost:0'
  const MGMT_TOKEN = 'test-management-token-secret'

  // Alice = human user (delegator)
  const aliceKey = generateEd25519SshKey()
  // Bob = agent user (delegate)
  const bobKey = generateEd25519SshKey()

  beforeAll(async () => {
    const instance = createIdPApp({
      issuer: ISSUER,
      managementToken: MGMT_TOKEN,
    })
    stores = instance.stores
    server = createServer(toNodeListener(instance.app))
    await new Promise<void>(resolve => server.listen(0, resolve))
    const addr = server.address() as { port: number }
    baseUrl = `http://localhost:${addr.port}`

    // Alice: human user
    await stores.userStore.create({
      email: 'alice@example.com',
      name: 'Alice',
      isActive: true,
      createdAt: Date.now(),
    })
    await stores.sshKeyStore.save({
      keyId: 'alice-key-1',
      userEmail: 'alice@example.com',
      publicKey: aliceKey.publicKey,
      name: 'Alice Key',
      createdAt: Math.floor(Date.now() / 1000),
    })

    // Bob: agent user (owner = Alice)
    await stores.userStore.create({
      email: 'bob@example.com',
      name: 'Bob Agent',
      owner: 'alice@example.com',
      approver: 'alice@example.com',
      isActive: true,
      createdAt: Date.now(),
    })
    await stores.sshKeyStore.save({
      keyId: 'bob-key-1',
      userEmail: 'bob@example.com',
      publicKey: bobKey.publicKey,
      name: 'Bob Key',
      createdAt: Math.floor(Date.now() / 1000),
    })
  })

  afterAll(() => {
    server.close()
  })

  async function api(path: string, opts?: RequestInit) {
    return fetch(`${baseUrl}${path}`, opts)
  }

  async function apiJson(path: string, body: unknown, headers?: Record<string, string>) {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  }

  async function getAuthToken(email: string, privateKey: import('node:crypto').KeyObject): Promise<string> {
    const challengeRes = await apiJson('/api/auth/challenge', { id: email })
    const { challenge } = await challengeRes.json()
    const signature = signChallenge(challenge, privateKey)
    const authRes = await apiJson('/api/auth/authenticate', {
      id: email,
      challenge,
      signature,
    })
    const data = await authRes.json()
    return data.token
  }

  // =========================================================================
  // Create delegation
  // =========================================================================

  describe('POST /api/delegations', () => {
    it('human Alice creates delegation for Bob', async () => {
      const token = await getAuthToken('alice@example.com', aliceKey.privateKey)

      const res = await apiJson('/api/delegations', {
        delegate: 'bob@example.com',
        audience: 'sp.example.com',
        grant_type: 'always',
        scopes: ['read', 'write'],
      }, { Authorization: `Bearer ${token}` })

      expect(res.status).toBe(201)
      const grant = await res.json()
      expect(grant.type).toBe('delegation')
      expect(grant.status).toBe('approved')
      expect(grant.request.delegator).toBe('alice@example.com')
      expect(grant.request.delegate).toBe('bob@example.com')
      expect(grant.request.audience).toBe('sp.example.com')
      expect(grant.request.scopes).toEqual(['read', 'write'])
      expect(grant.decided_by).toBe('alice@example.com')
    })

    it('defaults grant_type to once', async () => {
      const token = await getAuthToken('alice@example.com', aliceKey.privateKey)

      const res = await apiJson('/api/delegations', {
        delegate: 'bob@example.com',
        audience: 'sp.example.com',
      }, { Authorization: `Bearer ${token}` })

      expect(res.status).toBe(201)
      const grant = await res.json()
      expect(grant.request.grant_type).toBe('once')
    })

    it('agent Bob cannot create delegation (403)', async () => {
      const token = await getAuthToken('bob@example.com', bobKey.privateKey)

      const res = await apiJson('/api/delegations', {
        delegate: 'alice@example.com',
        audience: 'sp.example.com',
      }, { Authorization: `Bearer ${token}` })

      expect(res.status).toBe(403)
    })

    it('rejects without bearer token (401)', async () => {
      const res = await apiJson('/api/delegations', {
        delegate: 'bob@example.com',
        audience: 'sp.example.com',
      })

      expect(res.status).toBe(401)
    })

    it('rejects missing delegate', async () => {
      const token = await getAuthToken('alice@example.com', aliceKey.privateKey)

      const res = await apiJson('/api/delegations', {
        audience: 'sp.example.com',
      }, { Authorization: `Bearer ${token}` })

      expect(res.status).toBe(400)
    })

    it('rejects missing audience', async () => {
      const token = await getAuthToken('alice@example.com', aliceKey.privateKey)

      const res = await apiJson('/api/delegations', {
        delegate: 'bob@example.com',
      }, { Authorization: `Bearer ${token}` })

      expect(res.status).toBe(400)
    })

    it('rejects invalid grant_type', async () => {
      const token = await getAuthToken('alice@example.com', aliceKey.privateKey)

      const res = await apiJson('/api/delegations', {
        delegate: 'bob@example.com',
        audience: 'sp.example.com',
        grant_type: 'forever',
      }, { Authorization: `Bearer ${token}` })

      expect(res.status).toBe(400)
    })

    it('rejects timed without duration', async () => {
      const token = await getAuthToken('alice@example.com', aliceKey.privateKey)

      const res = await apiJson('/api/delegations', {
        delegate: 'bob@example.com',
        audience: 'sp.example.com',
        grant_type: 'timed',
      }, { Authorization: `Bearer ${token}` })

      expect(res.status).toBe(400)
    })

    it('creates timed delegation with duration', async () => {
      const token = await getAuthToken('alice@example.com', aliceKey.privateKey)

      const res = await apiJson('/api/delegations', {
        delegate: 'bob@example.com',
        audience: 'sp.example.com',
        grant_type: 'timed',
        duration: 3600,
      }, { Authorization: `Bearer ${token}` })

      expect(res.status).toBe(201)
      const grant = await res.json()
      expect(grant.request.grant_type).toBe('timed')
      expect(grant.request.duration).toBe(3600)
      expect(grant.expires_at).toBeDefined()
    })
  })

  // =========================================================================
  // List delegations
  // =========================================================================

  describe('GET /api/delegations', () => {
    beforeAll(async () => {
      // Create a fresh delegation for listing tests
      const token = await getAuthToken('alice@example.com', aliceKey.privateKey)
      await apiJson('/api/delegations', {
        delegate: 'bob@example.com',
        audience: 'list-test.example.com',
      }, { Authorization: `Bearer ${token}` })
    })

    it('Alice lists delegations as delegator', async () => {
      const token = await getAuthToken('alice@example.com', aliceKey.privateKey)

      const res = await api('/api/delegations?role=delegator', {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data).toBeDefined()
      expect(body.pagination).toBeDefined()
      expect(Array.isArray(body.data)).toBe(true)
      expect(body.data.length).toBeGreaterThan(0)
      expect(body.data.every((g: { request: { delegator: string } }) => g.request.delegator === 'alice@example.com')).toBe(true)
    })

    it('Bob lists delegations as delegate', async () => {
      const token = await getAuthToken('bob@example.com', bobKey.privateKey)

      const res = await api('/api/delegations?role=delegate', {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data).toBeDefined()
      expect(body.pagination).toBeDefined()
      expect(Array.isArray(body.data)).toBe(true)
      expect(body.data.length).toBeGreaterThan(0)
      expect(body.data.every((g: { request: { delegate: string } }) => g.request.delegate === 'bob@example.com')).toBe(true)
    })

    it('lists all delegations without role filter', async () => {
      const token = await getAuthToken('alice@example.com', aliceKey.privateKey)

      const res = await api('/api/delegations', {
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.data).toBeDefined()
      expect(body.pagination).toBeDefined()
      expect(Array.isArray(body.data)).toBe(true)
      expect(body.data.length).toBeGreaterThan(0)
    })

    it('rejects without bearer token', async () => {
      const res = await api('/api/delegations')
      expect(res.status).toBe(401)
    })

    it('results are sorted by created_at DESC', async () => {
      const token = await getAuthToken('alice@example.com', aliceKey.privateKey)

      const res = await api('/api/delegations?role=delegator', {
        headers: { Authorization: `Bearer ${token}` },
      })

      const body = await res.json()
      const data = body.data
      for (let i = 1; i < data.length; i++) {
        expect(data[i - 1].created_at).toBeGreaterThanOrEqual(data[i].created_at)
      }
    })

    it('supports cursor pagination', async () => {
      const token = await getAuthToken('alice@example.com', aliceKey.privateKey)

      // Get first page with limit=1
      const res1 = await api('/api/delegations?role=delegator&limit=1', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const page1 = await res1.json()
      expect(page1.data).toHaveLength(1)
      expect(page1.pagination.has_more).toBe(true)
      expect(page1.pagination.cursor).toBeDefined()

      // Get second page using cursor
      const res2 = await api(`/api/delegations?role=delegator&limit=1&cursor=${page1.pagination.cursor}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const page2 = await res2.json()
      expect(page2.data.length).toBeGreaterThanOrEqual(1)
      // Pages should not overlap
      expect(page2.data[0].id).not.toBe(page1.data[0].id)
    })

    it('supports search filter', async () => {
      const token = await getAuthToken('alice@example.com', aliceKey.privateKey)

      const res = await api('/api/delegations?search=list-test.example.com', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await res.json()
      expect(body.data.length).toBeGreaterThan(0)
      expect(body.data.every((g: { request: { audience: string } }) => g.request.audience.includes('list-test.example.com'))).toBe(true)
    })
  })

  // =========================================================================
  // Validate delegation
  // =========================================================================

  describe('POST /api/delegations/:id/validate', () => {
    let delegationId: string

    beforeAll(async () => {
      const token = await getAuthToken('alice@example.com', aliceKey.privateKey)
      const res = await apiJson('/api/delegations', {
        delegate: 'bob@example.com',
        audience: 'validate-test.example.com',
        grant_type: 'always',
      }, { Authorization: `Bearer ${token}` })
      const grant = await res.json()
      delegationId = grant.id
    })

    it('validates delegation for correct delegate and audience', async () => {
      const res = await apiJson(`/api/delegations/${delegationId}/validate`, {
        delegate: 'bob@example.com',
        audience: 'validate-test.example.com',
      })

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.valid).toBe(true)
      expect(data.delegation).toBeDefined()
      expect(data.scopes).toBeDefined()
    })

    it('returns invalid for wrong delegate', async () => {
      const res = await apiJson(`/api/delegations/${delegationId}/validate`, {
        delegate: 'wrong@example.com',
        audience: 'validate-test.example.com',
      })

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.valid).toBe(false)
      expect(data.error).toContain('Delegate does not match')
    })

    it('returns invalid for wrong audience', async () => {
      const res = await apiJson(`/api/delegations/${delegationId}/validate`, {
        delegate: 'bob@example.com',
        audience: 'wrong.example.com',
      })

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.valid).toBe(false)
      expect(data.error).toContain('Audience does not match')
    })

    it('returns invalid for non-existent delegation', async () => {
      const res = await apiJson('/api/delegations/nonexistent-id/validate', {
        delegate: 'bob@example.com',
        audience: 'validate-test.example.com',
      })

      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.valid).toBe(false)
    })

    it('rejects missing delegate or audience in body', async () => {
      const res = await apiJson(`/api/delegations/${delegationId}/validate`, {
        delegate: 'bob@example.com',
      })

      expect(res.status).toBe(400)
    })
  })

  // =========================================================================
  // Revoke delegation
  // =========================================================================

  describe('DELETE /api/delegations/:id', () => {
    it('delegator Alice revokes delegation', async () => {
      const aliceToken = await getAuthToken('alice@example.com', aliceKey.privateKey)

      // Create a delegation to revoke
      const createRes = await apiJson('/api/delegations', {
        delegate: 'bob@example.com',
        audience: 'revoke-test.example.com',
        grant_type: 'always',
      }, { Authorization: `Bearer ${aliceToken}` })
      const grant = await createRes.json()

      // Revoke it
      const res = await api(`/api/delegations/${grant.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${aliceToken}` },
      })

      expect(res.status).toBe(200)
      const revoked = await res.json()
      expect(revoked.status).toBe('revoked')
    })

    it('delegate Bob cannot revoke (403)', async () => {
      const aliceToken = await getAuthToken('alice@example.com', aliceKey.privateKey)
      const bobToken = await getAuthToken('bob@example.com', bobKey.privateKey)

      // Create a delegation
      const createRes = await apiJson('/api/delegations', {
        delegate: 'bob@example.com',
        audience: 'revoke-auth-test.example.com',
        grant_type: 'always',
      }, { Authorization: `Bearer ${aliceToken}` })
      const grant = await createRes.json()

      // Bob tries to revoke
      const res = await api(`/api/delegations/${grant.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${bobToken}` },
      })

      expect(res.status).toBe(403)
    })

    it('returns 404 for non-existent delegation', async () => {
      const token = await getAuthToken('alice@example.com', aliceKey.privateKey)

      const res = await api('/api/delegations/nonexistent-id', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(res.status).toBe(404)
    })

    it('validate fails after revoke', async () => {
      const aliceToken = await getAuthToken('alice@example.com', aliceKey.privateKey)

      // Create and revoke
      const createRes = await apiJson('/api/delegations', {
        delegate: 'bob@example.com',
        audience: 'revoke-validate.example.com',
        grant_type: 'always',
      }, { Authorization: `Bearer ${aliceToken}` })
      const grant = await createRes.json()

      await api(`/api/delegations/${grant.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${aliceToken}` },
      })

      // Now validate should fail
      const validateRes = await apiJson(`/api/delegations/${grant.id}/validate`, {
        delegate: 'bob@example.com',
        audience: 'revoke-validate.example.com',
      })

      expect(validateRes.status).toBe(200)
      const data = await validateRes.json()
      expect(data.valid).toBe(false)
      expect(data.error).toContain('not approved')
    })
  })

  // =========================================================================
  // Full OIDC delegation flow (authorize + token exchange)
  // =========================================================================

  describe('full OIDC delegation flow', () => {
    it('Bob authenticates with delegation_grant, SP sees Alice as sub and Bob as actor', async () => {
      // Step 1: Alice creates a delegation for Bob at sp.example.com
      const aliceToken = await getAuthToken('alice@example.com', aliceKey.privateKey)
      const createRes = await apiJson('/api/delegations', {
        delegate: 'bob@example.com',
        audience: 'sp.example.com',
        grant_type: 'always',
        scopes: ['read'],
      }, { Authorization: `Bearer ${aliceToken}` })
      expect(createRes.status).toBe(201)
      const delegation = await createRes.json()

      // Step 2: Bob gets his own auth token
      const bobToken = await getAuthToken('bob@example.com', bobKey.privateKey)

      // Step 3: Bob hits /authorize with delegation_grant parameter
      const codeVerifier = generateCodeVerifier()
      const codeChallenge = await generateCodeChallenge(codeVerifier)

      const authorizeRes = await api(
        `/authorize?response_type=code&client_id=sp.example.com&redirect_uri=${encodeURIComponent('http://sp.example.com/callback')}&state=deleg-flow&code_challenge=${codeChallenge}&code_challenge_method=S256&delegation_grant=${delegation.id}`,
        { headers: { Authorization: `Bearer ${bobToken}` }, redirect: 'manual' },
      )
      expect(authorizeRes.status).toBe(302)
      const location = authorizeRes.headers.get('location')!
      const code = new URL(location).searchParams.get('code')!
      expect(code).toBeDefined()

      // Step 4: Token exchange — Bob exchanges the code for tokens
      const tokenRes = await apiJson('/token', {
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        redirect_uri: 'http://sp.example.com/callback',
        client_id: 'sp.example.com',
      })
      expect(tokenRes.status).toBe(200)
      const tokenData = await tokenRes.json()
      expect(tokenData.assertion).toBeDefined()

      // Step 5: Verify the assertion JWT has sub=Alice, act={sub:Bob}
      const signingKey = await stores.keyStore.getSigningKey()
      const { payload } = await jwtVerify(tokenData.assertion, signingKey.publicKey, {
        issuer: ISSUER,
        audience: 'sp.example.com',
      })

      // sub should be the delegator (Alice)
      expect(payload.sub).toBe('alice@example.com')
      // act should be the delegation act claim with Bob as the actor
      expect(payload.act).toEqual({ sub: 'bob@example.com' })
      // delegation_grant should reference the delegation
      expect(payload.delegation_grant).toBe(delegation.id)
    })

    it('client_credentials delegation flow: assertion has sub=Alice, act={sub:Bob}', async () => {
      // Step 1: Alice creates a delegation for Bob
      const aliceToken = await getAuthToken('alice@example.com', aliceKey.privateKey)
      const createRes = await apiJson('/api/delegations', {
        delegate: 'bob@example.com',
        audience: 'sp.example.com',
        grant_type: 'always',
      }, { Authorization: `Bearer ${aliceToken}` })
      expect(createRes.status).toBe(201)
      const delegation = await createRes.json()

      // Step 2: Bob builds a client assertion JWT
      const assertion = await new SignJWT({
        sub: 'bob@example.com',
        iss: 'bob@example.com',
      })
        .setProtectedHeader({ alg: 'EdDSA' })
        .setAudience(`${ISSUER}/token`)
        .setIssuedAt()
        .setExpirationTime('5m')
        .setJti(crypto.randomUUID())
        .sign(bobKey.privateKey)

      // Step 3: Token exchange with delegation_grant
      const tokenRes = await apiJson('/token', {
        grant_type: 'client_credentials',
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: assertion,
        delegation_grant: delegation.id,
        audience: 'sp.example.com',
      })
      expect(tokenRes.status).toBe(200)
      const tokenData = await tokenRes.json()
      expect(tokenData.access_token).toBeDefined()
      expect(tokenData.expires_in).toBe(300)

      // Step 4: Verify the access_token (assertion) has correct claims
      const signingKey = await stores.keyStore.getSigningKey()
      const { payload } = await jwtVerify(tokenData.access_token, signingKey.publicKey, {
        issuer: ISSUER,
        audience: 'sp.example.com',
      })

      expect(payload.sub).toBe('alice@example.com')
      expect(payload.act).toEqual({ sub: 'bob@example.com' })
    })

    it('revoked delegation blocks authorize flow', async () => {
      const aliceToken = await getAuthToken('alice@example.com', aliceKey.privateKey)

      // Create and revoke
      const createRes = await apiJson('/api/delegations', {
        delegate: 'bob@example.com',
        audience: 'sp.example.com',
        grant_type: 'always',
      }, { Authorization: `Bearer ${aliceToken}` })
      const delegation = await createRes.json()

      await api(`/api/delegations/${delegation.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${aliceToken}` },
      })

      // Bob tries to use revoked delegation
      const bobToken = await getAuthToken('bob@example.com', bobKey.privateKey)
      const codeVerifier = generateCodeVerifier()
      const codeChallenge = await generateCodeChallenge(codeVerifier)

      const authorizeRes = await api(
        `/authorize?response_type=code&client_id=sp.example.com&redirect_uri=${encodeURIComponent('http://sp.example.com/callback')}&state=revoked&code_challenge=${codeChallenge}&code_challenge_method=S256&delegation_grant=${delegation.id}`,
        { headers: { Authorization: `Bearer ${bobToken}` }, redirect: 'manual' },
      )

      // Should fail — validateDelegation throws when grant is not approved
      // The error could be 400 or 500 depending on how the handler wraps the error
      expect(authorizeRes.status).toBeGreaterThanOrEqual(400)
    })
  })
})
