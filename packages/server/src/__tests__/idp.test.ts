import type { Server } from 'node:http'
import { createServer } from 'node:http'
import { generateKeyPairSync, sign } from 'node:crypto'
import { toNodeListener } from 'h3'
import { SignJWT } from 'jose'
import { generateCodeChallenge, generateCodeVerifier } from '@openape/core'
import { approveGrant, createGrant, issueAuthzJWT } from '@openape/grants'
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

describe('idp server', () => {
  let server: Server
  let baseUrl: string
  let stores: IdPStores
  const ISSUER = 'http://localhost:0'
  const MGMT_TOKEN = 'test-management-token-secret'

  // Keys generated once for all tests
  const ownerKey = generateEd25519SshKey()
  const agentKey = generateEd25519SshKey()
  const thirdKey = generateEd25519SshKey()

  beforeAll(async () => {
    const instance = createIdPApp({
      issuer: ISSUER,
      managementToken: MGMT_TOKEN,
      adminEmails: ['admin@example.com'],
    })
    stores = instance.stores
    server = createServer(toNodeListener(instance.app))
    await new Promise<void>(resolve => server.listen(0, resolve))
    const addr = server.address() as { port: number }
    baseUrl = `http://localhost:${addr.port}`

    // Pre-seed: create owner user with SSH key
    await stores.userStore.create({
      email: 'owner@example.com',
      name: 'Owner',
      isActive: true,
      createdAt: Date.now(),
    })
    await stores.sshKeyStore.save({
      keyId: 'owner-key-1',
      userEmail: 'owner@example.com',
      publicKey: ownerKey.publicKey,
      name: 'Owner Key',
      createdAt: Math.floor(Date.now() / 1000),
    })

    // Pre-seed: create agent user (user with owner set)
    await stores.userStore.create({
      email: 'agent@example.com',
      name: 'Test Agent',
      owner: 'owner@example.com',
      approver: 'owner@example.com',
      isActive: true,
      createdAt: Date.now(),
    })
    await stores.sshKeyStore.save({
      keyId: 'agent-key-1',
      userEmail: 'agent@example.com',
      publicKey: agentKey.publicKey,
      name: 'Agent Key',
      createdAt: Math.floor(Date.now() / 1000),
    })

    // Pre-seed: third user (no special role)
    await stores.userStore.create({
      email: 'third@example.com',
      name: 'Third User',
      isActive: true,
      createdAt: Date.now(),
    })
    await stores.sshKeyStore.save({
      keyId: 'third-key-1',
      userEmail: 'third@example.com',
      publicKey: thirdKey.publicKey,
      name: 'Third Key',
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

  /** Get a fresh auth token for a user by doing challenge+authenticate */
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
  // Discovery & JWKS
  // =========================================================================

  describe('discovery', () => {
    it('returns OpenID configuration', async () => {
      const res = await api('/.well-known/openid-configuration')
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.issuer).toBe(ISSUER)
      expect(data.authorization_endpoint).toBe(`${ISSUER}/authorize`)
      expect(data.token_endpoint).toBe(`${ISSUER}/token`)
      expect(data.jwks_uri).toBe(`${ISSUER}/.well-known/jwks.json`)
      expect(data.ddisa_version).toBe('1.0')
      expect(data.grant_types_supported).toContain('authorization_code')
      expect(data.grant_types_supported).toContain('client_credentials')
      expect(data.grant_types_supported).toContain('refresh_token')
    })
  })

  describe('jwks', () => {
    it('returns public keys', async () => {
      const res = await api('/.well-known/jwks.json')
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.keys).toBeDefined()
      expect(data.keys.length).toBeGreaterThan(0)
      expect(data.keys[0].alg).toBe('EdDSA')
      expect(data.keys[0].use).toBe('sig')
      expect(data.keys[0].kid).toBeDefined()
    })
  })

  // =========================================================================
  // Admin SSH Key Management
  // =========================================================================

  describe('admin ssh keys', () => {
    const testEmail = 'admin-test@example.com'

    it('rejects without management token', async () => {
      const res = await apiJson(`/api/admin/users/${encodeURIComponent(testEmail)}/ssh-keys`, {
        publicKey: 'ssh-ed25519 AAAA',
      })
      expect(res.status).toBe(401)
    })

    it('rejects with wrong management token', async () => {
      const res = await apiJson(
        `/api/admin/users/${encodeURIComponent(testEmail)}/ssh-keys`,
        { publicKey: 'ssh-ed25519 AAAA' },
        { Authorization: 'Bearer wrong-token' },
      )
      expect(res.status).toBe(403)
    })

    it('adds an SSH key and creates user if needed', async () => {
      const newKey = generateEd25519SshKey()
      const res = await apiJson(
        `/api/admin/users/${encodeURIComponent(testEmail)}/ssh-keys`,
        { publicKey: newKey.publicKey, name: 'Admin Test Key' },
        { Authorization: `Bearer ${MGMT_TOKEN}` },
      )
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.userEmail).toBe(testEmail)
      expect(data.name).toBe('Admin Test Key')
      expect(data.keyId).toBeDefined()
    })

    it('rejects duplicate SSH key', async () => {
      const keys = await stores.sshKeyStore.findByUser(testEmail)
      const res = await apiJson(
        `/api/admin/users/${encodeURIComponent(testEmail)}/ssh-keys`,
        { publicKey: keys[0]!.publicKey },
        { Authorization: `Bearer ${MGMT_TOKEN}` },
      )
      expect(res.status).toBe(409)
    })

    it('rejects invalid SSH key format', async () => {
      const res = await apiJson(
        `/api/admin/users/${encodeURIComponent(testEmail)}/ssh-keys`,
        { publicKey: 'not-a-valid-key' },
        { Authorization: `Bearer ${MGMT_TOKEN}` },
      )
      expect(res.status).toBe(400)
    })

    it('rejects missing publicKey', async () => {
      const res = await apiJson(
        `/api/admin/users/${encodeURIComponent(testEmail)}/ssh-keys`,
        {},
        { Authorization: `Bearer ${MGMT_TOKEN}` },
      )
      expect(res.status).toBe(400)
    })

    it('lists SSH keys for a user', async () => {
      const res = await api(
        `/api/admin/users/${encodeURIComponent(testEmail)}/ssh-keys`,
        { headers: { Authorization: `Bearer ${MGMT_TOKEN}` } },
      )
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.length).toBe(1)
      expect(data[0].userEmail).toBe(testEmail)
    })

    it('deletes an SSH key', async () => {
      const keys = await stores.sshKeyStore.findByUser(testEmail)
      const keyId = keys[0]!.keyId

      const res = await api(
        `/api/admin/users/${encodeURIComponent(testEmail)}/ssh-keys/${keyId}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${MGMT_TOKEN}` } },
      )
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)
    })

    it('returns 404 for non-existent key deletion', async () => {
      const res = await api(
        `/api/admin/users/${encodeURIComponent(testEmail)}/ssh-keys/nonexistent`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${MGMT_TOKEN}` } },
      )
      expect(res.status).toBe(404)
    })

    it('uses comment as fallback name', async () => {
      const newKey = generateEd25519SshKey()
      const keyWithComment = `${newKey.publicKey} my-comment`
      const res = await apiJson(
        `/api/admin/users/${encodeURIComponent('comment-test@example.com')}/ssh-keys`,
        { publicKey: keyWithComment },
        { Authorization: `Bearer ${MGMT_TOKEN}` },
      )
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.name).toBe('my-comment')
    })
  })

  // =========================================================================
  // Admin User Management (list + delete)
  // =========================================================================

  describe('admin users', () => {
    it('lists users with management token', async () => {
      // Create two dedicated users for this test
      await stores.userStore.create({
        email: 'listuser1@example.com',
        name: 'List User 1',
        isActive: true,
        createdAt: Date.now(),
      })
      await stores.userStore.create({
        email: 'listuser2@example.com',
        name: 'List User 2',
        isActive: true,
        createdAt: Date.now(),
      })

      const res = await api('/api/admin/users', {
        headers: { Authorization: `Bearer ${MGMT_TOKEN}` },
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      const emails = data.map((u: { email: string }) => u.email)
      expect(emails).toContain('listuser1@example.com')
      expect(emails).toContain('listuser2@example.com')
      // Verify shape: only projected fields returned
      for (const u of data) {
        expect(u).toHaveProperty('email')
        expect(u).toHaveProperty('name')
        expect(u).toHaveProperty('isActive')
        expect(u).toHaveProperty('createdAt')
      }

      // Clean up
      await stores.userStore.delete('listuser1@example.com')
      await stores.userStore.delete('listuser2@example.com')
    })

    it('list users requires management token', async () => {
      const res = await api('/api/admin/users')
      expect(res.status).toBe(401)
    })

    it('deletes a user and cleans up SSH keys', async () => {
      // Create user + SSH key
      const delKey = generateEd25519SshKey()
      await stores.userStore.create({
        email: 'deleteuser@example.com',
        name: 'Delete Me',
        isActive: true,
        createdAt: Date.now(),
      })
      await stores.sshKeyStore.save({
        keyId: 'del-user-key',
        userEmail: 'deleteuser@example.com',
        publicKey: delKey.publicKey,
        name: 'Del Key',
        createdAt: Math.floor(Date.now() / 1000),
      })

      // Verify user exists
      const userBefore = await stores.userStore.findByEmail('deleteuser@example.com')
      expect(userBefore).toBeDefined()
      const keysBefore = await stores.sshKeyStore.findByUser('deleteuser@example.com')
      expect(keysBefore.length).toBe(1)

      const res = await api(`/api/admin/users/${encodeURIComponent('deleteuser@example.com')}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${MGMT_TOKEN}` },
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.ok).toBe(true)

      // Verify user and keys are gone
      const userAfter = await stores.userStore.findByEmail('deleteuser@example.com')
      expect(userAfter).toBeFalsy()
      const keysAfter = await stores.sshKeyStore.findByUser('deleteuser@example.com')
      expect(keysAfter.length).toBe(0)
    })

    it('delete user returns 404 for non-existent user', async () => {
      const res = await api(`/api/admin/users/${encodeURIComponent('nonexistent@example.com')}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${MGMT_TOKEN}` },
      })
      expect(res.status).toBe(404)
    })

    it('delete user requires management token', async () => {
      const res = await api(`/api/admin/users/${encodeURIComponent('owner@example.com')}`, {
        method: 'DELETE',
      })
      expect(res.status).toBe(401)
    })
  })

  // =========================================================================
  // Enroll (agent creation)
  // =========================================================================

  describe('enroll', () => {
    it('rejects without management token', async () => {
      const k = generateEd25519SshKey()
      const res = await apiJson('/api/auth/enroll', {
        email: 'enroll-test@example.com',
        name: 'Enroll Test',
        publicKey: k.publicKey,
        owner: 'owner@example.com',
      })
      expect(res.status).toBe(401)
    })

    it('enrolls a new agent (user with owner)', async () => {
      const k = generateEd25519SshKey()
      const res = await apiJson(
        '/api/auth/enroll',
        {
          email: 'enrolled-agent@example.com',
          name: 'Enrolled Agent',
          publicKey: k.publicKey,
          owner: 'owner@example.com',
        },
        { Authorization: `Bearer ${MGMT_TOKEN}` },
      )
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.email).toBe('enrolled-agent@example.com')
      expect(data.owner).toBe('owner@example.com')
      expect(data.status).toBe('active')
    })

    it('rejects duplicate email', async () => {
      const k = generateEd25519SshKey()
      const res = await apiJson(
        '/api/auth/enroll',
        {
          email: 'enrolled-agent@example.com',
          name: 'Dup',
          publicKey: k.publicKey,
          owner: 'owner@example.com',
        },
        { Authorization: `Bearer ${MGMT_TOKEN}` },
      )
      expect(res.status).toBe(409)
    })

    it('rejects duplicate public key', async () => {
      // Get the enrolled agent's key
      const keys = await stores.sshKeyStore.findByUser('enrolled-agent@example.com')
      const res = await apiJson(
        '/api/auth/enroll',
        {
          email: 'dup-key@example.com',
          name: 'Dup Key',
          publicKey: keys[0]!.publicKey,
          owner: 'owner@example.com',
        },
        { Authorization: `Bearer ${MGMT_TOKEN}` },
      )
      expect(res.status).toBe(409)
    })

    it('rejects missing required fields', async () => {
      const res = await apiJson(
        '/api/auth/enroll',
        { email: 'x@example.com' },
        { Authorization: `Bearer ${MGMT_TOKEN}` },
      )
      expect(res.status).toBe(400)
    })

    it('rejects non-ssh-ed25519 key', async () => {
      const res = await apiJson(
        '/api/auth/enroll',
        {
          email: 'bad-key@example.com',
          name: 'Bad Key',
          publicKey: 'ssh-rsa AAAAB3...',
          owner: 'owner@example.com',
        },
        { Authorization: `Bearer ${MGMT_TOKEN}` },
      )
      expect(res.status).toBe(400)
    })

    it('rejects invalid ssh-ed25519 key data', async () => {
      const res = await apiJson(
        '/api/auth/enroll',
        {
          email: 'invalid-data@example.com',
          name: 'Invalid Data',
          publicKey: 'ssh-ed25519 invalidbase64data',
          owner: 'owner@example.com',
        },
        { Authorization: `Bearer ${MGMT_TOKEN}` },
      )
      expect(res.status).toBe(400)
    })
  })

  // =========================================================================
  // User-initiated enroll (Bearer token)
  // =========================================================================

  describe('user-initiated enroll', () => {
    it('human user enrolls a sub-user via Bearer token', async () => {
      const ownerToken = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const k = generateEd25519SshKey()
      const res = await apiJson(
        '/api/auth/enroll',
        {
          email: 'sub-user-bob@example.com',
          name: 'Sub Bob',
          publicKey: k.publicKey,
        },
        { Authorization: `Bearer ${ownerToken}` },
      )
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.email).toBe('sub-user-bob@example.com')
      expect(data.owner).toBe('owner@example.com')
      expect(data.approver).toBe('owner@example.com')
      expect(data.type).toBe('agent')
      expect(data.status).toBe('active')
    })

    it('human user enrolls with explicit type: human', async () => {
      const ownerToken = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const k = generateEd25519SshKey()
      const res = await apiJson(
        '/api/auth/enroll',
        {
          email: 'sub-user-carol@example.com',
          name: 'Sub Carol',
          publicKey: k.publicKey,
          type: 'human',
        },
        { Authorization: `Bearer ${ownerToken}` },
      )
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.email).toBe('sub-user-carol@example.com')
      expect(data.type).toBe('human')
      expect(data.owner).toBe('owner@example.com')
    })

    it('enrolled sub-user with type: human has correct user record', async () => {
      // Carol was enrolled with type: 'human', verify the user record
      const carolKeys = await stores.sshKeyStore.findByUser('sub-user-carol@example.com')
      expect(carolKeys.length).toBe(1)

      // Verify challenge endpoint works (user is enrolled and active)
      const challengeRes = await apiJson('/api/auth/challenge', { id: 'sub-user-carol@example.com' })
      expect(challengeRes.status).toBe(200)

      // Verify type is set correctly in store
      const carol = await stores.userStore.findByEmail('sub-user-carol@example.com')
      expect(carol).toBeTruthy()
      expect(carol!.type).toBe('human')
      expect(carol!.owner).toBe('owner@example.com')
    })

    it('agent user cannot enroll sub-users (403)', async () => {
      const agentToken = await getAuthToken('agent@example.com', agentKey.privateKey)
      const k = generateEd25519SshKey()
      const res = await apiJson(
        '/api/auth/enroll',
        {
          email: 'should-fail@example.com',
          name: 'Should Fail',
          publicKey: k.publicKey,
        },
        { Authorization: `Bearer ${agentToken}` },
      )
      expect(res.status).toBe(403)
    })

    it('rejects unauthenticated request without mgmt token', async () => {
      const k = generateEd25519SshKey()
      const res = await apiJson('/api/auth/enroll', {
        email: 'no-auth@example.com',
        name: 'No Auth',
        publicKey: k.publicKey,
      })
      expect(res.status).toBe(401)
    })

    it('rejects duplicate email via Bearer token', async () => {
      const ownerToken = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const k = generateEd25519SshKey()
      const res = await apiJson(
        '/api/auth/enroll',
        {
          email: 'sub-user-bob@example.com',
          name: 'Dup Bob',
          publicKey: k.publicKey,
        },
        { Authorization: `Bearer ${ownerToken}` },
      )
      expect(res.status).toBe(409)
    })

    it('Bearer token enroll ignores body.owner (uses caller)', async () => {
      const ownerToken = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const k = generateEd25519SshKey()
      const res = await apiJson(
        '/api/auth/enroll',
        {
          email: 'sub-user-dave@example.com',
          name: 'Sub Dave',
          publicKey: k.publicKey,
          owner: 'someone-else@example.com',
        },
        { Authorization: `Bearer ${ownerToken}` },
      )
      expect(res.status).toBe(200)
      const data = await res.json()
      // Owner should be the caller, not the body value
      expect(data.owner).toBe('owner@example.com')
    })

    it('management token enroll still works with type field', async () => {
      const k = generateEd25519SshKey()
      const res = await apiJson(
        '/api/auth/enroll',
        {
          email: 'mgmt-typed@example.com',
          name: 'Mgmt Typed',
          publicKey: k.publicKey,
          owner: 'owner@example.com',
          type: 'human',
        },
        { Authorization: `Bearer ${MGMT_TOKEN}` },
      )
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.type).toBe('human')
      expect(data.owner).toBe('owner@example.com')
    })
  })

  // =========================================================================
  // Challenge + Authenticate
  // =========================================================================

  describe('challenge + authenticate', () => {
    it('rejects challenge with missing id', async () => {
      const res = await apiJson('/api/auth/challenge', {})
      expect(res.status).toBe(400)
    })

    it('returns 404 for unknown identity', async () => {
      const res = await apiJson('/api/auth/challenge', { id: 'unknown@example.com' })
      expect(res.status).toBe(404)
    })

    it('issues a challenge for agent', async () => {
      const res = await apiJson('/api/auth/challenge', { id: 'agent@example.com' })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.challenge).toBeDefined()
      expect(typeof data.challenge).toBe('string')
    })

    it('issues a challenge for human with SSH key', async () => {
      const res = await apiJson('/api/auth/challenge', { id: 'owner@example.com' })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.challenge).toBeDefined()
    })

    it('rejects authenticate with missing fields', async () => {
      const res = await apiJson('/api/auth/authenticate', { id: 'agent@example.com' })
      expect(res.status).toBe(400)
    })

    it('rejects authenticate for non-existent user', async () => {
      const res = await apiJson('/api/auth/authenticate', {
        id: 'nonexistent@example.com',
        challenge: 'fake',
        signature: 'fake',
      })
      expect(res.status).toBe(404)
    })

    it('authenticates agent with act=agent', async () => {
      const challengeRes = await apiJson('/api/auth/challenge', { id: 'agent@example.com' })
      const { challenge } = await challengeRes.json()
      const signature = signChallenge(challenge, agentKey.privateKey)

      const authRes = await apiJson('/api/auth/authenticate', {
        id: 'agent@example.com',
        challenge,
        signature,
      })
      expect(authRes.status).toBe(200)
      const data = await authRes.json()
      expect(data.token).toBeDefined()
      expect(data.act).toBe('agent')
      expect(data.email).toBe('agent@example.com')
      expect(data.expires_in).toBe(3600)
    })

    it('authenticates human with act=human', async () => {
      const challengeRes = await apiJson('/api/auth/challenge', { id: 'owner@example.com' })
      const { challenge } = await challengeRes.json()
      const signature = signChallenge(challenge, ownerKey.privateKey)

      const authRes = await apiJson('/api/auth/authenticate', {
        id: 'owner@example.com',
        challenge,
        signature,
      })
      expect(authRes.status).toBe(200)
      const data = await authRes.json()
      expect(data.token).toBeDefined()
      expect(data.act).toBe('human')
    })

    it('rejects invalid challenge', async () => {
      const authRes = await apiJson('/api/auth/authenticate', {
        id: 'agent@example.com',
        challenge: 'invalid-challenge',
        signature: Buffer.from('fakesig').toString('base64'),
      })
      expect(authRes.status).toBe(401)
    })

    it('rejects invalid signature', async () => {
      const challengeRes = await apiJson('/api/auth/challenge', { id: 'agent@example.com' })
      const { challenge } = await challengeRes.json()
      const wrongSig = signChallenge(challenge, ownerKey.privateKey)

      const authRes = await apiJson('/api/auth/authenticate', {
        id: 'agent@example.com',
        challenge,
        signature: wrongSig,
      })
      expect(authRes.status).toBe(401)
    })

    it('authenticates with explicit public_key', async () => {
      const challengeRes = await apiJson('/api/auth/challenge', { id: 'agent@example.com' })
      const { challenge } = await challengeRes.json()
      const signature = signChallenge(challenge, agentKey.privateKey)

      const authRes = await apiJson('/api/auth/authenticate', {
        id: 'agent@example.com',
        challenge,
        signature,
        public_key: agentKey.publicKey,
      })
      expect(authRes.status).toBe(200)
    })

    it('rejects public_key from different user', async () => {
      const challengeRes = await apiJson('/api/auth/challenge', { id: 'agent@example.com' })
      const { challenge } = await challengeRes.json()
      const signature = signChallenge(challenge, agentKey.privateKey)

      const authRes = await apiJson('/api/auth/authenticate', {
        id: 'agent@example.com',
        challenge,
        signature,
        public_key: ownerKey.publicKey,
      })
      expect(authRes.status).toBe(404)
    })

    it('rejects non-existent public_key', async () => {
      const challengeRes = await apiJson('/api/auth/challenge', { id: 'agent@example.com' })
      const { challenge } = await challengeRes.json()

      const authRes = await apiJson('/api/auth/authenticate', {
        id: 'agent@example.com',
        challenge,
        signature: Buffer.from('fake').toString('base64'),
        public_key: 'ssh-ed25519 nonexistentkey',
      })
      expect(authRes.status).toBe(404)
    })

    it('rejects inactive user', async () => {
      await stores.userStore.update('agent@example.com', { isActive: false })

      const res = await apiJson('/api/auth/authenticate', {
        id: 'agent@example.com',
        challenge: 'x',
        signature: 'y',
      })
      expect(res.status).toBe(403)

      await stores.userStore.update('agent@example.com', { isActive: true })
    })

    it('requires public_key disambiguation with multiple keys', async () => {
      const secondKey = generateEd25519SshKey()
      await stores.sshKeyStore.save({
        keyId: 'owner-key-2',
        userEmail: 'owner@example.com',
        publicKey: secondKey.publicKey,
        name: 'Second Owner Key',
        createdAt: Math.floor(Date.now() / 1000),
      })

      const challengeRes = await apiJson('/api/auth/challenge', { id: 'owner@example.com' })
      const { challenge } = await challengeRes.json()
      const signature = signChallenge(challenge, ownerKey.privateKey)

      const authRes = await apiJson('/api/auth/authenticate', {
        id: 'owner@example.com',
        challenge,
        signature,
      })
      expect(authRes.status).toBe(400)

      await stores.sshKeyStore.delete('owner-key-2')
    })
  })

  // =========================================================================
  // Authorize + Token (OIDC code flow)
  // =========================================================================

  describe('authorize + token', () => {
    it('redirects to login when authorize called without bearer token or session', async () => {
      const res = await api('/authorize?response_type=code&client_id=sp.example.com&redirect_uri=http://sp.example.com/callback&state=s1&code_challenge=abc&code_challenge_method=S256', {
        redirect: 'manual',
      })
      expect(res.status).toBe(302)
      const location = res.headers.get('location')!
      expect(location).toContain('/login?returnTo=')
    })

    it('redirects with error for invalid response_type', async () => {
      const token = await getAuthToken('agent@example.com', agentKey.privateKey)
      const res = await api(
        '/authorize?response_type=invalid&client_id=sp.example.com&redirect_uri=http://sp.example.com/callback&state=s1&code_challenge=abc&code_challenge_method=S256',
        { headers: { Authorization: `Bearer ${token}` }, redirect: 'manual' },
      )
      expect(res.status).toBe(302)
      const location = res.headers.get('location')!
      expect(location).toContain('error=invalid_request')
    })

    it('returns 400 for invalid request with bad redirect_uri', async () => {
      const token = await getAuthToken('agent@example.com', agentKey.privateKey)
      // No redirect_uri at all + invalid response_type
      const res = await api(
        '/authorize?response_type=invalid&client_id=sp.example.com&state=s1&code_challenge=abc&code_challenge_method=S256',
        { headers: { Authorization: `Bearer ${token}` }, redirect: 'manual' },
      )
      // Missing redirect_uri, so we can't redirect the error → should be 400
      expect(res.status).toBe(400)
    })

    it('issues auth code and exchanges for token', async () => {
      const token = await getAuthToken('agent@example.com', agentKey.privateKey)
      const codeVerifier = generateCodeVerifier()
      const codeChallenge = await generateCodeChallenge(codeVerifier)

      const authorizeRes = await api(
        `/authorize?response_type=code&client_id=sp.example.com&redirect_uri=${encodeURIComponent('http://sp.example.com/callback')}&state=teststate&code_challenge=${codeChallenge}&code_challenge_method=S256&scope=openid+email+profile`,
        { headers: { Authorization: `Bearer ${token}` }, redirect: 'manual' },
      )
      expect(authorizeRes.status).toBe(302)
      const location = authorizeRes.headers.get('location')!
      const redirectUrl = new URL(location)
      expect(redirectUrl.searchParams.get('state')).toBe('teststate')
      const code = redirectUrl.searchParams.get('code')!
      expect(code).toBeDefined()

      const tokenRes = await apiJson('/token', {
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        redirect_uri: 'http://sp.example.com/callback',
        client_id: 'sp.example.com',
      })
      expect(tokenRes.status).toBe(200)
      const tokenData = await tokenRes.json()
      expect(tokenData.id_token).toBeDefined()
      expect(tokenData.access_token).toBeDefined()
      expect(tokenData.assertion).toBeDefined()
      expect(tokenData.token_type).toBe('Bearer')
      expect(tokenData.expires_in).toBe(300)
    })

    it('supports form-urlencoded token requests', async () => {
      const token = await getAuthToken('agent@example.com', agentKey.privateKey)
      const codeVerifier = generateCodeVerifier()
      const codeChallenge = await generateCodeChallenge(codeVerifier)

      const authorizeRes = await api(
        `/authorize?response_type=code&client_id=sp.example.com&redirect_uri=${encodeURIComponent('http://sp.example.com/callback')}&state=s2&code_challenge=${codeChallenge}&code_challenge_method=S256`,
        { headers: { Authorization: `Bearer ${token}` }, redirect: 'manual' },
      )
      const code = new URL(authorizeRes.headers.get('location')!).searchParams.get('code')!

      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        redirect_uri: 'http://sp.example.com/callback',
        client_id: 'sp.example.com',
      })

      const tokenRes = await fetch(`${baseUrl}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
      expect(tokenRes.status).toBe(200)
    })

    it('rejects invalid auth code', async () => {
      const tokenRes = await apiJson('/token', {
        grant_type: 'authorization_code',
        code: 'invalid-code',
        code_verifier: 'x',
        redirect_uri: 'http://sp.example.com/callback',
        client_id: 'sp.example.com',
      })
      // h3 catches the error and returns 400 from createError
      const data = await tokenRes.json()
      expect(data.error).toBe('invalid_grant')
    })

    it('rejects unsupported grant_type', async () => {
      const tokenRes = await apiJson('/token', { grant_type: 'urn:unknown' })
      const data = await tokenRes.json()
      expect(data.error).toBe('unsupported_grant_type')
    })

    it('rejects malformed JSON body', async () => {
      const res = await fetch(`${baseUrl}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json{',
      })
      const data = await res.json()
      expect(data.error).toBe('invalid_request')
    })

    it('rejects authorization_code with missing fields', async () => {
      const tokenRes = await apiJson('/token', {
        grant_type: 'authorization_code',
        code: 'x',
      })
      const data = await tokenRes.json()
      expect(data.error).toBe('invalid_request')
    })

    it('issues refresh token with offline_access scope', async () => {
      const token = await getAuthToken('agent@example.com', agentKey.privateKey)
      const codeVerifier = generateCodeVerifier()
      const codeChallenge = await generateCodeChallenge(codeVerifier)

      const authorizeRes = await api(
        `/authorize?response_type=code&client_id=sp.example.com&redirect_uri=${encodeURIComponent('http://sp.example.com/callback')}&state=s3&code_challenge=${codeChallenge}&code_challenge_method=S256&scope=openid+offline_access`,
        { headers: { Authorization: `Bearer ${token}` }, redirect: 'manual' },
      )
      const code = new URL(authorizeRes.headers.get('location')!).searchParams.get('code')!

      const tokenRes = await apiJson('/token', {
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        redirect_uri: 'http://sp.example.com/callback',
        client_id: 'sp.example.com',
      })
      const tokenData = await tokenRes.json()
      expect(tokenData.refresh_token).toBeDefined()

      // Use refresh token
      const refreshRes = await apiJson('/token', {
        grant_type: 'refresh_token',
        refresh_token: tokenData.refresh_token,
        client_id: 'sp.example.com',
      })
      expect(refreshRes.status).toBe(200)
      const refreshData = await refreshRes.json()
      expect(refreshData.access_token).toBeDefined()
      expect(refreshData.refresh_token).toBeDefined()
    })

    it('rejects refresh_token missing token', async () => {
      const res = await apiJson('/token', { grant_type: 'refresh_token' })
      const data = await res.json()
      expect(data.error).toBe('invalid_request')
    })

    it('rejects refresh_token missing client_id', async () => {
      const res = await apiJson('/token', { grant_type: 'refresh_token', refresh_token: 'x' })
      const data = await res.json()
      expect(data.error).toBe('invalid_request')
    })

    it('rejects invalid refresh_token', async () => {
      const res = await apiJson('/token', { grant_type: 'refresh_token', refresh_token: 'invalid', client_id: 'sp' })
      const data = await res.json()
      expect(data.error).toBe('invalid_grant')
    })
  })

  // =========================================================================
  // Client Credentials
  // =========================================================================

  describe('client credentials', () => {
    it('rejects unsupported assertion type', async () => {
      const res = await apiJson('/token', {
        grant_type: 'client_credentials',
        client_assertion_type: 'urn:wrong',
        client_assertion: 'x',
      })
      const data = await res.json()
      expect(data.error).toBe('invalid_request')
    })

    it('rejects missing assertion', async () => {
      const res = await apiJson('/token', {
        grant_type: 'client_credentials',
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      })
      const data = await res.json()
      expect(data.error).toBe('invalid_request')
    })

    it('issues agent token via client_credentials', async () => {
      // Use the agent key already in the store
      const assertion = await new SignJWT({
        sub: 'agent@example.com',
        iss: 'agent@example.com',
      })
        .setProtectedHeader({ alg: 'EdDSA' })
        .setAudience(`${ISSUER}/token`)
        .setIssuedAt()
        .setExpirationTime('5m')
        .setJti(crypto.randomUUID())
        .sign(agentKey.privateKey)

      const res = await apiJson('/token', {
        grant_type: 'client_credentials',
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: assertion,
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.access_token).toBeDefined()
      expect(data.token_type).toBe('Bearer')
      expect(data.expires_in).toBe(3600)
    })

    it('rejects invalid client assertion JWT', async () => {
      const res = await apiJson('/token', {
        grant_type: 'client_credentials',
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: 'invalid.jwt.here',
      })
      const data = await res.json()
      expect(data.error).toBe('invalid_client')
    })
  })

  // =========================================================================
  // Grants CRUD
  // =========================================================================

  describe('grants', () => {
    it('creates a grant (bearer sets requester)', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const res = await apiJson(
        '/api/grants',
        {
          target_host: 'sp.example.com',
          audience: 'sp.example.com',
          grant_type: 'once',
          permissions: ['read'],
        },
        { Authorization: `Bearer ${token}` },
      )
      expect(res.status).toBe(201)
      const data = await res.json()
      expect(data.id).toBeDefined()
      expect(data.status).toBe('pending')
      expect(data.request.requester).toBe('owner@example.com')
    })

    it('creates a grant with default grant_type', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const res = await apiJson(
        '/api/grants',
        { target_host: 'sp.example.com', audience: 'sp.example.com' },
        { Authorization: `Bearer ${token}` },
      )
      expect(res.status).toBe(201)
      const data = await res.json()
      expect(data.request.grant_type).toBe('once')
    })

    it('rejects grant with missing fields', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const res = await apiJson('/api/grants', { requester: 'x' }, { Authorization: `Bearer ${token}` })
      expect(res.status).toBe(400)
    })

    it('rejects invalid grant_type', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const res = await apiJson(
        '/api/grants',
        { target_host: 'sp.example.com', audience: 'sp.example.com', grant_type: 'invalid' },
        { Authorization: `Bearer ${token}` },
      )
      expect(res.status).toBe(400)
    })

    it('rejects timed without duration', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const res = await apiJson(
        '/api/grants',
        { target_host: 'sp.example.com', audience: 'sp.example.com', grant_type: 'timed' },
        { Authorization: `Bearer ${token}` },
      )
      expect(res.status).toBe(400)
    })

    it('gets a grant by ID with ETag', async () => {
      const grant = await createGrant({
        requester: 'owner@example.com',
        target_host: 'sp.example.com',
        audience: 'sp.example.com',
      }, stores.grantStore)

      const res = await api(`/api/grants/${grant.id}`)
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.id).toBe(grant.id)
      expect(res.headers.get('etag')).toBeDefined()
    })

    it('returns 304 for matching ETag', async () => {
      const grant = await createGrant({
        requester: 'owner@example.com',
        target_host: 'sp.example.com',
        audience: 'sp.example.com',
      }, stores.grantStore)

      const res1 = await api(`/api/grants/${grant.id}`)
      const etag = res1.headers.get('etag')!

      const res2 = await api(`/api/grants/${grant.id}`, {
        headers: { 'If-None-Match': etag },
      })
      expect(res2.status).toBe(304)
    })

    it('returns 404 for non-existent grant', async () => {
      const res = await api('/api/grants/nonexistent-id')
      expect(res.status).toBe(404)
    })

    it('approves a grant', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const grant = await createGrant({
        requester: 'owner@example.com',
        target_host: 'sp.example.com',
        audience: 'sp.example.com',
      }, stores.grantStore)

      const res = await apiJson(
        `/api/grants/${grant.id}/approve`,
        {},
        { Authorization: `Bearer ${token}` },
      )
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.grant.status).toBe('approved')
      expect(data.authz_jwt).toBeDefined()
    })

    it('approves with management token', async () => {
      const grant = await createGrant({
        requester: 'owner@example.com',
        target_host: 'sp.example.com',
        audience: 'sp.example.com',
      }, stores.grantStore)

      const res = await apiJson(
        `/api/grants/${grant.id}/approve`,
        {},
        { Authorization: `Bearer ${MGMT_TOKEN}` },
      )
      expect(res.status).toBe(200)
    })

    it('rejects approve for non-existent grant', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const res = await apiJson(`/api/grants/nonexistent/approve`, {}, { Authorization: `Bearer ${token}` })
      expect(res.status).toBe(404)
    })

    it('rejects approve for already decided grant', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const grant = await createGrant({
        requester: 'owner@example.com',
        target_host: 'sp.example.com',
        audience: 'sp.example.com',
      }, stores.grantStore)

      await approveGrant(grant.id, 'owner@example.com', stores.grantStore)

      const res = await apiJson(`/api/grants/${grant.id}/approve`, {}, { Authorization: `Bearer ${token}` })
      expect(res.status).toBe(400)
    })

    it('approves with grant_type override', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const grant = await createGrant({
        requester: 'owner@example.com',
        target_host: 'sp.example.com',
        audience: 'sp.example.com',
      }, stores.grantStore)

      const res = await apiJson(
        `/api/grants/${grant.id}/approve`,
        { grant_type: 'timed', duration: 3600 },
        { Authorization: `Bearer ${token}` },
      )
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.grant.request.grant_type).toBe('timed')
      expect(data.grant.expires_at).toBeDefined()
    })

    it('rejects approve with invalid grant_type', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const grant = await createGrant({
        requester: 'owner@example.com',
        target_host: 'sp.example.com',
        audience: 'sp.example.com',
      }, stores.grantStore)

      const res = await apiJson(
        `/api/grants/${grant.id}/approve`,
        { grant_type: 'invalid' },
        { Authorization: `Bearer ${token}` },
      )
      expect(res.status).toBe(400)
    })

    it('rejects approve with timed but no duration', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const grant = await createGrant({
        requester: 'owner@example.com',
        target_host: 'sp.example.com',
        audience: 'sp.example.com',
      }, stores.grantStore)

      const res = await apiJson(
        `/api/grants/${grant.id}/approve`,
        { grant_type: 'timed' },
        { Authorization: `Bearer ${token}` },
      )
      expect(res.status).toBe(400)
    })

    it('denies a grant', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const grant = await createGrant({
        requester: 'owner@example.com',
        target_host: 'sp.example.com',
        audience: 'sp.example.com',
      }, stores.grantStore)

      const res = await apiJson(`/api/grants/${grant.id}/deny`, {}, { Authorization: `Bearer ${token}` })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.status).toBe('denied')
    })

    it('rejects deny for non-existent grant', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const res = await apiJson(`/api/grants/nonexistent/deny`, {}, { Authorization: `Bearer ${token}` })
      expect(res.status).toBe(404)
    })

    it('rejects deny for already decided grant', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const grant = await createGrant({
        requester: 'owner@example.com',
        target_host: 'sp.example.com',
        audience: 'sp.example.com',
      }, stores.grantStore)

      await approveGrant(grant.id, 'owner@example.com', stores.grantStore)
      const res = await apiJson(`/api/grants/${grant.id}/deny`, {}, { Authorization: `Bearer ${token}` })
      expect(res.status).toBe(400)
    })

    it('revokes a grant', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const grant = await createGrant({
        requester: 'owner@example.com',
        target_host: 'sp.example.com',
        audience: 'sp.example.com',
      }, stores.grantStore)
      await approveGrant(grant.id, 'owner@example.com', stores.grantStore)

      const res = await apiJson(`/api/grants/${grant.id}/revoke`, {}, { Authorization: `Bearer ${token}` })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.status).toBe('revoked')
    })

    it('rejects revoke for non-existent grant', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const res = await apiJson(`/api/grants/nonexistent/revoke`, {}, { Authorization: `Bearer ${token}` })
      expect(res.status).toBe(404)
    })

    it('rejects revoke for already revoked grant', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const grant = await createGrant({
        requester: 'owner@example.com',
        target_host: 'sp.example.com',
        audience: 'sp.example.com',
      }, stores.grantStore)
      await approveGrant(grant.id, 'owner@example.com', stores.grantStore)
      await stores.grantStore.updateStatus(grant.id, 'denied')

      const res = await apiJson(`/api/grants/${grant.id}/revoke`, {}, { Authorization: `Bearer ${token}` })
      expect(res.status).toBe(400)
    })

    it('gets grant token (authz JWT)', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const grant = await createGrant({
        requester: 'owner@example.com',
        target_host: 'sp.example.com',
        audience: 'sp.example.com',
      }, stores.grantStore)
      await approveGrant(grant.id, 'owner@example.com', stores.grantStore)

      const res = await apiJson(`/api/grants/${grant.id}/token`, {}, { Authorization: `Bearer ${token}` })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.authz_jwt).toBeDefined()
      expect(data.grant.id).toBe(grant.id)
    })

    it('rejects grant token without bearer', async () => {
      const res = await apiJson('/api/grants/any-id/token', {})
      expect(res.status).toBe(401)
    })

    it('rejects grant token for non-existent grant', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const res = await apiJson('/api/grants/nonexistent/token', {}, { Authorization: `Bearer ${token}` })
      expect(res.status).toBe(404)
    })

    it('rejects grant token for non-owned grant', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const grant = await createGrant({
        requester: 'agent@example.com',
        target_host: 'sp.example.com',
        audience: 'sp.example.com',
      }, stores.grantStore)
      await approveGrant(grant.id, 'owner@example.com', stores.grantStore)

      const res = await apiJson(`/api/grants/${grant.id}/token`, {}, { Authorization: `Bearer ${token}` })
      expect(res.status).toBe(403)
    })

    it('rejects grant token for pending grant', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const grant = await createGrant({
        requester: 'owner@example.com',
        target_host: 'sp.example.com',
        audience: 'sp.example.com',
      }, stores.grantStore)

      const res = await apiJson(`/api/grants/${grant.id}/token`, {}, { Authorization: `Bearer ${token}` })
      expect(res.status).toBe(400)
    })

    it('consumes a once grant', async () => {
      const grant = await createGrant({
        requester: 'owner@example.com',
        target_host: 'sp.example.com',
        audience: 'sp.example.com',
        grant_type: 'once',
      }, stores.grantStore)
      const approved = await approveGrant(grant.id, 'owner@example.com', stores.grantStore)
      const signingKey = await stores.keyStore.getSigningKey()
      const authzJwt = await issueAuthzJWT(approved, ISSUER, signingKey.privateKey, signingKey.kid)

      const res = await apiJson(`/api/grants/${grant.id}/consume`, {}, { Authorization: `Bearer ${authzJwt}` })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.status).toBe('consumed')

      // Second consume
      const res2 = await apiJson(`/api/grants/${grant.id}/consume`, {}, { Authorization: `Bearer ${authzJwt}` })
      const data2 = await res2.json()
      expect(data2.error).toBe('already_consumed')
    })

    it('validates timed grant without consuming', async () => {
      const grant = await createGrant({
        requester: 'owner@example.com',
        target_host: 'sp.example.com',
        audience: 'sp.example.com',
        grant_type: 'timed',
        duration: 3600,
      }, stores.grantStore)
      const approved = await approveGrant(grant.id, 'owner@example.com', stores.grantStore)
      const signingKey = await stores.keyStore.getSigningKey()
      const authzJwt = await issueAuthzJWT(approved, ISSUER, signingKey.privateKey, signingKey.kid)

      const res = await apiJson(`/api/grants/${grant.id}/consume`, {}, { Authorization: `Bearer ${authzJwt}` })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.status).toBe('valid')
    })

    it('consume rejects without bearer', async () => {
      const res = await apiJson('/api/grants/any/consume', {})
      expect(res.status).toBe(401)
    })

    it('consume rejects invalid authz JWT', async () => {
      const res = await apiJson('/api/grants/any/consume', {}, { Authorization: 'Bearer invalid.jwt.here' })
      expect(res.status).toBe(401)
    })

    it('consume rejects mismatched grant ID', async () => {
      const grant = await createGrant({
        requester: 'owner@example.com',
        target_host: 'sp.example.com',
        audience: 'sp.example.com',
      }, stores.grantStore)
      const approved = await approveGrant(grant.id, 'owner@example.com', stores.grantStore)
      const signingKey = await stores.keyStore.getSigningKey()
      const authzJwt = await issueAuthzJWT(approved, ISSUER, signingKey.privateKey, signingKey.kid)

      const res = await apiJson('/api/grants/different-id/consume', {}, { Authorization: `Bearer ${authzJwt}` })
      expect(res.status).toBe(400)
    })

    it('consume reports denied/revoked/pending/expired grants', async () => {
      const signingKey = await stores.keyStore.getSigningKey()

      // denied
      const g1 = await createGrant({ requester: 'owner@example.com', target_host: 'sp', audience: 'sp' }, stores.grantStore)
      await approveGrant(g1.id, 'owner@example.com', stores.grantStore)
      const jwt1 = await issueAuthzJWT((await stores.grantStore.findById(g1.id))!, ISSUER, signingKey.privateKey, signingKey.kid)
      await stores.grantStore.updateStatus(g1.id, 'denied')
      const r1 = await apiJson(`/api/grants/${g1.id}/consume`, {}, { Authorization: `Bearer ${jwt1}` })
      expect((await r1.json()).error).toBe('denied')

      // revoked
      const g2 = await createGrant({ requester: 'owner@example.com', target_host: 'sp', audience: 'sp' }, stores.grantStore)
      await approveGrant(g2.id, 'owner@example.com', stores.grantStore)
      const jwt2 = await issueAuthzJWT((await stores.grantStore.findById(g2.id))!, ISSUER, signingKey.privateKey, signingKey.kid)
      await stores.grantStore.updateStatus(g2.id, 'revoked')
      const r2 = await apiJson(`/api/grants/${g2.id}/consume`, {}, { Authorization: `Bearer ${jwt2}` })
      expect((await r2.json()).error).toBe('revoked')

      // pending
      const g3 = await createGrant({ requester: 'owner@example.com', target_host: 'sp', audience: 'sp' }, stores.grantStore)
      await approveGrant(g3.id, 'owner@example.com', stores.grantStore)
      const jwt3 = await issueAuthzJWT((await stores.grantStore.findById(g3.id))!, ISSUER, signingKey.privateKey, signingKey.kid)
      await stores.grantStore.updateStatus(g3.id, 'pending')
      const r3 = await apiJson(`/api/grants/${g3.id}/consume`, {}, { Authorization: `Bearer ${jwt3}` })
      expect((await r3.json()).error).toBe('not_approved')

      // expired (timed grant with past expires_at)
      const g4 = await createGrant({ requester: 'owner@example.com', target_host: 'sp', audience: 'sp', grant_type: 'timed', duration: 1 }, stores.grantStore)
      await approveGrant(g4.id, 'owner@example.com', stores.grantStore)
      const jwt4 = await issueAuthzJWT((await stores.grantStore.findById(g4.id))!, ISSUER, signingKey.privateKey, signingKey.kid)
      // Set expires_at to the past
      await stores.grantStore.updateStatus(g4.id, 'approved', { expires_at: Math.floor(Date.now() / 1000) - 10 })
      const r4 = await apiJson(`/api/grants/${g4.id}/consume`, {}, { Authorization: `Bearer ${jwt4}` })
      expect((await r4.json()).error).toBe('expired')
    })

    it('lists grants for authenticated user', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const res = await api('/api/grants', { headers: { Authorization: `Bearer ${token}` } })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.data).toBeDefined()
      expect(data.pagination).toBeDefined()
    })

    it('lists grants by requester param', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const res = await api('/api/grants?requester=owner@example.com', { headers: { Authorization: `Bearer ${token}` } })
      expect(res.status).toBe(200)
    })

    it('lists grants with status filter', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const res = await api('/api/grants?status=approved', { headers: { Authorization: `Bearer ${token}` } })
      expect(res.status).toBe(200)
      const data = await res.json()
      for (const g of data.data) {
        expect(g.status).toBe('approved')
      }
    })

    it('lists with cursor pagination', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const res = await api('/api/grants?limit=2', { headers: { Authorization: `Bearer ${token}` } })
      expect(res.status).toBe(200)
      const data = await res.json()
      if (data.pagination.cursor) {
        const res2 = await api(`/api/grants?limit=2&cursor=${data.pagination.cursor}`, { headers: { Authorization: `Bearer ${token}` } })
        expect(res2.status).toBe(200)
      }
    })

    it('rejects listing without bearer', async () => {
      const res = await api('/api/grants')
      expect(res.status).toBe(401)
    })

    it('batch processes grants', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const g1 = await createGrant({ requester: 'owner@example.com', target_host: 'batch1', audience: 'batch1' }, stores.grantStore)
      const g2 = await createGrant({ requester: 'owner@example.com', target_host: 'batch2', audience: 'batch2' }, stores.grantStore)

      const res = await apiJson(
        '/api/grants/batch',
        { operations: [{ id: g1.id, action: 'approve' }, { id: g2.id, action: 'deny' }] },
        { Authorization: `Bearer ${token}` },
      )
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.results[0].success).toBe(true)
      expect(data.results[0].status).toBe('approved')
      expect(data.results[1].success).toBe(true)
      expect(data.results[1].status).toBe('denied')
    })

    it('batch returns 207 on partial error', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const g1 = await createGrant({ requester: 'owner@example.com', target_host: 'batch3', audience: 'batch3' }, stores.grantStore)

      const res = await apiJson(
        '/api/grants/batch',
        { operations: [{ id: g1.id, action: 'approve' }, { id: 'nonexistent', action: 'approve' }] },
        { Authorization: `Bearer ${token}` },
      )
      expect(res.status).toBe(207)
    })

    it('batch with revoke', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const g1 = await createGrant({ requester: 'owner@example.com', target_host: 'batch4', audience: 'batch4' }, stores.grantStore)

      const res = await apiJson(
        '/api/grants/batch',
        { operations: [{ id: g1.id, action: 'revoke' }] },
        { Authorization: `Bearer ${token}` },
      )
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.results[0].status).toBe('revoked')
    })

    it('batch rejects empty operations', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const res = await apiJson('/api/grants/batch', { operations: [] }, { Authorization: `Bearer ${token}` })
      expect(res.status).toBe(400)
    })

    it('batch rejects missing operations', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const res = await apiJson('/api/grants/batch', {}, { Authorization: `Bearer ${token}` })
      expect(res.status).toBe(400)
    })

    it('approve rejects unauthorized user', async () => {
      const thirdToken = await getAuthToken('third@example.com', thirdKey.privateKey)
      const grant = await createGrant({
        requester: 'agent@example.com',
        target_host: 'sp.example.com',
        audience: 'sp.example.com',
      }, stores.grantStore)

      const res = await apiJson(`/api/grants/${grant.id}/approve`, {}, { Authorization: `Bearer ${thirdToken}` })
      expect(res.status).toBe(403)
    })

    it('deny rejects unauthorized user (not owner/approver)', async () => {
      const thirdToken = await getAuthToken('third@example.com', thirdKey.privateKey)
      const grant = await createGrant({
        requester: 'agent@example.com',
        target_host: 'sp.example.com',
        audience: 'sp.example.com',
      }, stores.grantStore)

      const res = await apiJson(`/api/grants/${grant.id}/deny`, {}, { Authorization: `Bearer ${thirdToken}` })
      expect(res.status).toBe(403)
    })

    it('deny rejects when requester not found', async () => {
      const ownerToken = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const grant = await createGrant({
        requester: 'ghost@example.com',
        target_host: 'sp.example.com',
        audience: 'sp.example.com',
      }, stores.grantStore)

      const res = await apiJson(`/api/grants/${grant.id}/deny`, {}, { Authorization: `Bearer ${ownerToken}` })
      expect(res.status).toBe(403)
    })

    it('revoke rejects unauthorized non-approver', async () => {
      const thirdToken = await getAuthToken('third@example.com', thirdKey.privateKey)
      const grant = await createGrant({
        requester: 'agent@example.com',
        target_host: 'sp.example.com',
        audience: 'sp.example.com',
      }, stores.grantStore)
      await approveGrant(grant.id, 'owner@example.com', stores.grantStore)

      const res = await apiJson(`/api/grants/${grant.id}/revoke`, {}, { Authorization: `Bearer ${thirdToken}` })
      expect(res.status).toBe(403)

      // Management token can revoke
      const mgmtRes = await apiJson(`/api/grants/${grant.id}/revoke`, {}, { Authorization: `Bearer ${MGMT_TOKEN}` })
      expect(mgmtRes.status).toBe(200)
    })
  })

  // =========================================================================
  // Management token not configured
  // =========================================================================

  // =========================================================================
  // Edge cases for coverage
  // =========================================================================

  describe('edge cases', () => {
    it('challenge for user with SSH keys but not in userStore', async () => {
      // Register SSH key without creating user in userStore
      const orphanKey = generateEd25519SshKey()
      await stores.sshKeyStore.save({
        keyId: 'orphan-key',
        userEmail: 'orphan@example.com',
        publicKey: orphanKey.publicKey,
        name: 'Orphan Key',
        createdAt: Math.floor(Date.now() / 1000),
      })

      const res = await apiJson('/api/auth/challenge', { id: 'orphan@example.com' })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.challenge).toBeDefined()

      // Clean up
      await stores.sshKeyStore.delete('orphan-key')
    })

    it('authenticate user with no SSH keys returns 404', async () => {
      // Create a user with no SSH keys
      await stores.userStore.create({
        email: 'nokeys@example.com',
        name: 'No Keys',
        isActive: true,
        createdAt: Date.now(),
      })

      // Get a challenge first (will fail since no keys)
      // We need to manufacture a challenge for this user
      const challenge = await stores.challengeStore.createChallenge('nokeys@example.com')

      const res = await apiJson('/api/auth/authenticate', {
        id: 'nokeys@example.com',
        challenge,
        signature: Buffer.from('fake').toString('base64'),
      })
      expect(res.status).toBe(404)

      await stores.userStore.delete('nokeys@example.com')
    })

    it('authorize with authorization_details creates grants', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const codeVerifier = generateCodeVerifier()
      const codeChallenge = await generateCodeChallenge(codeVerifier)

      const details = JSON.stringify([
        { type: 'openape_grant', action: 'read', approval: 'once' },
      ])

      const res = await api(
        `/authorize?response_type=code&client_id=sp.example.com&redirect_uri=${encodeURIComponent('http://sp.example.com/callback')}&state=authz-detail&code_challenge=${codeChallenge}&code_challenge_method=S256&authorization_details=${encodeURIComponent(details)}`,
        { headers: { Authorization: `Bearer ${token}` }, redirect: 'manual' },
      )
      expect(res.status).toBe(302)
      const location = res.headers.get('location')!
      const code = new URL(location).searchParams.get('code')!

      // Exchange for token — should include authorization_details
      const tokenRes = await apiJson('/token', {
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        redirect_uri: 'http://sp.example.com/callback',
        client_id: 'sp.example.com',
      })
      expect(tokenRes.status).toBe(200)
      const tokenData = await tokenRes.json()
      expect(tokenData.authorization_details).toBeDefined()
      expect(tokenData.authorization_details.length).toBe(1)
      expect(tokenData.authorization_details[0].grant_id).toBeDefined()
    })

    it('authorize with invalid authorization_details JSON is ignored', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const codeVerifier = generateCodeVerifier()
      const codeChallenge = await generateCodeChallenge(codeVerifier)

      const res = await api(
        `/authorize?response_type=code&client_id=sp.example.com&redirect_uri=${encodeURIComponent('http://sp.example.com/callback')}&state=bad-json&code_challenge=${codeChallenge}&code_challenge_method=S256&authorization_details=not-json`,
        { headers: { Authorization: `Bearer ${token}` }, redirect: 'manual' },
      )
      expect(res.status).toBe(302) // Still works, just ignores bad details
    })

    it('authorize with non-array authorization_details is ignored', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const codeVerifier = generateCodeVerifier()
      const codeChallenge = await generateCodeChallenge(codeVerifier)

      const res = await api(
        `/authorize?response_type=code&client_id=sp.example.com&redirect_uri=${encodeURIComponent('http://sp.example.com/callback')}&state=obj-json&code_challenge=${codeChallenge}&code_challenge_method=S256&authorization_details=${encodeURIComponent('{"not":"array"}')}`,
        { headers: { Authorization: `Bearer ${token}` }, redirect: 'manual' },
      )
      expect(res.status).toBe(302)
    })

    it('authorize with delegation_grant param', async () => {
      const token = await getAuthToken('agent@example.com', agentKey.privateKey)
      const codeVerifier = generateCodeVerifier()
      const codeChallenge = await generateCodeChallenge(codeVerifier)

      // Create a delegation grant
      const { createDelegation } = await import('@openape/grants')
      const delegation = await createDelegation({
        delegator: 'owner@example.com',
        delegate: 'agent@example.com',
        audience: 'sp.example.com',
        grant_type: 'always',
      }, stores.grantStore)

      const res = await api(
        `/authorize?response_type=code&client_id=sp.example.com&redirect_uri=${encodeURIComponent('http://sp.example.com/callback')}&state=deleg&code_challenge=${codeChallenge}&code_challenge_method=S256&delegation_grant=${delegation.id}`,
        { headers: { Authorization: `Bearer ${token}` }, redirect: 'manual' },
      )
      expect(res.status).toBe(302)
      const code = new URL(res.headers.get('location')!).searchParams.get('code')!
      expect(code).toBeDefined()
    })

    it('client_credentials delegation flow', async () => {
      // Create a delegation grant
      const { createDelegation } = await import('@openape/grants')
      const delegation = await createDelegation({
        delegator: 'owner@example.com',
        delegate: 'agent@example.com',
        audience: 'sp.example.com',
        grant_type: 'always',
      }, stores.grantStore)

      // Build client assertion JWT
      const assertion = await new SignJWT({
        sub: 'agent@example.com',
        iss: 'agent@example.com',
      })
        .setProtectedHeader({ alg: 'EdDSA' })
        .setAudience(`${ISSUER}/token`)
        .setIssuedAt()
        .setExpirationTime('5m')
        .setJti(crypto.randomUUID())
        .sign(agentKey.privateKey)

      const res = await apiJson('/token', {
        grant_type: 'client_credentials',
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: assertion,
        delegation_grant: delegation.id,
        audience: 'sp.example.com',
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.access_token).toBeDefined()
      expect(data.expires_in).toBe(300)
    })

    it('client_credentials delegation without audience returns error', async () => {
      const assertion = await new SignJWT({
        sub: 'agent@example.com',
        iss: 'agent@example.com',
      })
        .setProtectedHeader({ alg: 'EdDSA' })
        .setAudience(`${ISSUER}/token`)
        .setIssuedAt()
        .setExpirationTime('5m')
        .setJti(crypto.randomUUID())
        .sign(agentKey.privateKey)

      const res = await apiJson('/token', {
        grant_type: 'client_credentials',
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: assertion,
        delegation_grant: 'some-grant-id',
      })
      const data = await res.json()
      expect(data.error).toBe('invalid_request')
      expect(data.error_description).toContain('audience')
    })

    it('batch with invalid action reports error', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const g1 = await createGrant({ requester: 'owner@example.com', target_host: 'sp', audience: 'sp' }, stores.grantStore)

      const res = await apiJson(
        '/api/grants/batch',
        { operations: [{ id: g1.id, action: 'invalid' }] },
        { Authorization: `Bearer ${token}` },
      )
      expect(res.status).toBe(207)
      const data = await res.json()
      expect(data.results[0].success).toBe(false)
    })

    it('token endpoint resolves user claims based on scope', async () => {
      const token = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const codeVerifier = generateCodeVerifier()
      const codeChallenge = await generateCodeChallenge(codeVerifier)

      // Request only email scope
      const authorizeRes = await api(
        `/authorize?response_type=code&client_id=sp.example.com&redirect_uri=${encodeURIComponent('http://sp.example.com/callback')}&state=scope-test&code_challenge=${codeChallenge}&code_challenge_method=S256&scope=openid+email`,
        { headers: { Authorization: `Bearer ${token}` }, redirect: 'manual' },
      )
      const code = new URL(authorizeRes.headers.get('location')!).searchParams.get('code')!

      const tokenRes = await apiJson('/token', {
        grant_type: 'authorization_code',
        code,
        code_verifier: codeVerifier,
        redirect_uri: 'http://sp.example.com/callback',
        client_id: 'sp.example.com',
      })
      expect(tokenRes.status).toBe(200)
    })

    it('approve rejects when requester not in userStore', async () => {
      const ownerToken = await getAuthToken('owner@example.com', ownerKey.privateKey)
      const grant = await createGrant({
        requester: 'ghost@example.com',
        target_host: 'sp.example.com',
        audience: 'sp.example.com',
      }, stores.grantStore)

      const res = await apiJson(`/api/grants/${grant.id}/approve`, {}, { Authorization: `Bearer ${ownerToken}` })
      expect(res.status).toBe(403)
    })

    it('consume reports grant not found for non-existent grant', async () => {
      // Create a valid-looking authz JWT with a fake grant_id
      const signingKey = await stores.keyStore.getSigningKey()
      const { signJWT } = await import('@openape/core')
      const fakeGrantId = 'nonexistent-grant-id'
      const token = await signJWT(
        {
          iss: ISSUER,
          sub: 'owner@example.com',
          aud: 'sp.example.com',
          iat: Math.floor(Date.now() / 1000),
          exp: Math.floor(Date.now() / 1000) + 300,
          jti: crypto.randomUUID(),
          grant_id: fakeGrantId,
          grant_type: 'once',
          approval: 'once',
          target_host: 'sp.example.com',
        },
        signingKey.privateKey,
        { kid: signingKey.kid },
      )

      const res = await apiJson(`/api/grants/${fakeGrantId}/consume`, {}, { Authorization: `Bearer ${token}` })
      expect(res.status).toBe(404)
    })

    it('ed25519 rejects key with wrong raw length', async () => {
      // Build an SSH key with correct ssh-ed25519 wire type but wrong key length (16 instead of 32)
      const typeStr = 'ssh-ed25519'
      const typeBuf = Buffer.from(typeStr)
      const typeLen = Buffer.alloc(4)
      typeLen.writeUInt32BE(typeBuf.length)
      const shortKey = Buffer.alloc(16) // wrong length
      const keyLen = Buffer.alloc(4)
      keyLen.writeUInt32BE(shortKey.length)
      const wireFormat = Buffer.concat([typeLen, typeBuf, keyLen, shortKey])

      const { sshEd25519ToKeyObject } = await import('../idp/utils/ed25519.js')
      expect(() => sshEd25519ToKeyObject(`ssh-ed25519 ${wireFormat.toString('base64')}`))
        .toThrow('Expected 32-byte')
    })

    it('challenge for inactive user falls through to SSH key check', async () => {
      // Deactivate agent, but keys still exist
      await stores.userStore.update('agent@example.com', { isActive: false })

      const res = await apiJson('/api/auth/challenge', { id: 'agent@example.com' })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data.challenge).toBeDefined()

      await stores.userStore.update('agent@example.com', { isActive: true })
    })
  })

  // =========================================================================
  // Direct utility tests for coverage
  // =========================================================================

  describe('utility functions', () => {
    it('verifyAuthToken rejects invalid act claim', async () => {
      const signingKey = await stores.keyStore.getSigningKey()
      const { SignJWT: JWTBuilder } = await import('jose')
      // Issue JWT with invalid act
      const token = await new JWTBuilder({ act: 'invalid' })
        .setProtectedHeader({ alg: 'EdDSA' })
        .setIssuer(ISSUER)
        .setSubject('test@example.com')
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(signingKey.privateKey)

      const { verifyAuthToken } = await import('../idp/utils/auth-token.js')
      await expect(verifyAuthToken(token, ISSUER, signingKey.publicKey))
        .rejects
        .toThrow('Invalid act claim')
    })

    it('sshEd25519ToKeyObject rejects non-ssh-ed25519 wire format', async () => {
      // Build an SSH key with valid base64 but wrong key type in wire format
      const typeStr = 'ssh-rsa'
      const typeBuf = Buffer.from(typeStr)
      const typeLen = Buffer.alloc(4)
      typeLen.writeUInt32BE(typeBuf.length)
      const fakeKey = Buffer.alloc(32)
      const keyLen = Buffer.alloc(4)
      keyLen.writeUInt32BE(fakeKey.length)
      const wireFormat = Buffer.concat([typeLen, typeBuf, keyLen, fakeKey])

      const { sshEd25519ToKeyObject } = await import('../idp/utils/ed25519.js')
      expect(() => sshEd25519ToKeyObject(`ssh-ed25519 ${wireFormat.toString('base64')}`))
        .toThrow('Unexpected key type in wire format')
    })
  })

  describe('management token not configured', () => {
    let noMgmtServer: Server
    let noMgmtUrl: string

    beforeAll(async () => {
      const instance = createIdPApp({ issuer: 'http://localhost:0' })
      noMgmtServer = createServer(toNodeListener(instance.app))
      await new Promise<void>(resolve => noMgmtServer.listen(0, resolve))
      const addr = noMgmtServer.address() as { port: number }
      noMgmtUrl = `http://localhost:${addr.port}`
    })

    afterAll(() => noMgmtServer.close())

    it('returns 401 when management token not configured and Bearer token invalid', async () => {
      // Without management token configured, the enroll endpoint falls through
      // to Bearer auth, which fails because 'any' is not a valid JWT.
      const k = generateEd25519SshKey()
      const res = await fetch(`${noMgmtUrl}/api/auth/enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer any' },
        body: JSON.stringify({
          email: 'x@example.com',
          name: 'X',
          publicKey: k.publicKey,
          owner: 'y@example.com',
        }),
      })
      expect(res.status).toBe(401)
    })
  })
})
