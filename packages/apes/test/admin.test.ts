import type { Server } from 'node:http'
import type { KeyObject } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'
import { createRouter, defineEventHandler, readBody, setResponseStatus, toNodeListener } from 'h3'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createIdPApp } from '@openape/server'
import { SignJWT } from 'jose'
import consola from 'consola'

// ---------------------------------------------------------------------------
// Isolate HOME
// ---------------------------------------------------------------------------

const testHome = join(tmpdir(), `apes-admin-${process.pid}-${Date.now()}`)
mkdirSync(testHome, { recursive: true })

vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>()
  return { ...original, homedir: () => testHome }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestUser {
  email: string
  name: string
  publicKeySsh: string
  privateKey: KeyObject
  privateKeyPem: string
  jwt?: string
}

function generateTestKeyPair() {
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
  const publicKeySsh = `ssh-ed25519 ${wireFormat.toString('base64')}`
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string

  return { publicKeySsh, privateKeyPem, privateKey }
}

function createTestUser(email: string, name: string): TestUser {
  const kp = generateTestKeyPair()
  return { email, name, publicKeySsh: kp.publicKeySsh, privateKey: kp.privateKey, privateKeyPem: kp.privateKeyPem }
}

function listenOnFreePort(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') resolve(addr.port)
      else reject(new Error('Failed to get server address'))
    })
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise(resolve => server.close(() => resolve()))
}

function writeAuthAs(user: TestUser, idpBase: string) {
  if (!user.jwt) throw new Error(`No JWT for ${user.email}. Call getJwtFor() first.`)
  const configDir = join(testHome, '.config', 'apes')
  mkdirSync(configDir, { recursive: true })
  writeFileSync(join(configDir, 'auth.json'), JSON.stringify({
    idp: idpBase,
    access_token: user.jwt,
    email: user.email,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  }, null, 2), { mode: 0o600 })
}

async function getJwtFor(user: TestUser, idpBase: string): Promise<string> {
  const challengeResp = await fetch(`${idpBase}/api/agent/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_id: user.email }),
  })
  if (!challengeResp.ok) throw new Error(`Challenge failed for ${user.email}: ${await challengeResp.text()}`)
  const { challenge } = await challengeResp.json() as { challenge: string }

  const signature = sign(null, Buffer.from(challenge), user.privateKey).toString('base64')

  const authResp = await fetch(`${idpBase}/api/agent/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent_id: user.email, challenge, signature }),
  })
  if (!authResp.ok) throw new Error(`Authenticate failed for ${user.email}: ${await authResp.text()}`)
  const { token } = await authResp.json() as { token: string }
  return token
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('admin + delegation-revoke commands', () => {
  let server: Server
  let port: number
  let idpBase: string
  const MGMT_TOKEN = 'test-mgmt-token-admin'

  let alice: TestUser

  let logOutput: string[]
  let stdoutOutput: string[]

  beforeAll(async () => {
    alice = createTestUser('alice@example.com', 'Alice')

    // Start IdP
    const tempIdp = createIdPApp({ issuer: 'http://placeholder', managementToken: MGMT_TOKEN })
    const tempServer = createServer(toNodeListener(tempIdp.app))
    port = await listenOnFreePort(tempServer)
    await closeServer(tempServer)

    idpBase = `http://127.0.0.1:${port}`
    process.env.APES_IDP = idpBase
    process.env.APES_MANAGEMENT_TOKEN = MGMT_TOKEN

    const idp = createIdPApp({
      issuer: idpBase,
      managementToken: MGMT_TOKEN,
      adminEmails: ['alice@example.com'],
    })

    // Compat routes for challenge-response auth
    const { stores } = idp
    const compatRouter = createRouter()

    compatRouter.post('/api/agent/challenge', defineEventHandler(async (event) => {
      const body = await readBody<{ agent_id: string }>(event)
      if (!body.agent_id) {
        setResponseStatus(event, 400)
        return { error: 'Missing agent_id' }
      }
      const user = await stores.userStore.findByEmail(body.agent_id)
      if (!user || !user.isActive) {
        setResponseStatus(event, 404)
        return { error: 'User not found' }
      }
      const challenge = await stores.challengeStore.createChallenge(user.email)
      return { challenge }
    }))

    compatRouter.post('/api/agent/authenticate', defineEventHandler(async (event) => {
      const body = await readBody<{ agent_id: string, challenge: string, signature: string }>(event)
      if (!body.agent_id || !body.challenge || !body.signature) {
        setResponseStatus(event, 400)
        return { error: 'Missing required fields' }
      }
      const user = await stores.userStore.findByEmail(body.agent_id)
      if (!user || !user.isActive) {
        setResponseStatus(event, 404)
        return { error: 'User not found' }
      }
      const valid = await stores.challengeStore.consumeChallenge(body.challenge, body.agent_id)
      if (!valid) {
        setResponseStatus(event, 401)
        return { error: 'Invalid or expired challenge' }
      }
      const keys = await stores.sshKeyStore.findByUser(body.agent_id)
      if (keys.length === 0) {
        setResponseStatus(event, 404)
        return { error: 'No SSH keys found' }
      }
      let verified = false
      for (const sshKey of keys) {
        try {
          const parts = sshKey.publicKey.trim().split(/\s+/)
          const keyData = Buffer.from(parts[1]!, 'base64')
          const typeLen = keyData.readUInt32BE(0)
          const rawKey = keyData.subarray(4 + typeLen + 4)
          const pubKeyObj = createPublicKey({
            key: { kty: 'OKP', crv: 'Ed25519', x: rawKey.toString('base64url') },
            format: 'jwk',
          })
          const signatureBuffer = Buffer.from(body.signature, 'base64')
          verified = verify(null, Buffer.from(body.challenge), pubKeyObj, signatureBuffer)
          if (verified) break
        }
        catch { /* try next key */ }
      }
      if (!verified) {
        setResponseStatus(event, 401)
        return { error: 'Invalid signature' }
      }
      const signingKey = await stores.keyStore.getSigningKey()
      const token = await new SignJWT({
        sub: user.email,
        act: user.owner ? 'agent' : 'human',
      })
        .setProtectedHeader({ alg: 'EdDSA', kid: signingKey.kid })
        .setIssuer(idpBase)
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(signingKey.privateKey)

      return {
        token,
        id: user.email,
        email: user.email,
        name: user.name,
        expires_in: 3600,
      }
    }))

    idp.app.use(compatRouter)

    server = createServer(toNodeListener(idp.app))
    await new Promise<void>((resolve, reject) => {
      server.listen(port, '127.0.0.1', () => resolve())
      server.on('error', reject)
    })

    // Register Alice as human admin
    const aliceCreateRes = await fetch(`${idpBase}/api/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MGMT_TOKEN}` },
      body: JSON.stringify({ email: alice.email, name: alice.name, isActive: true }),
    })
    if (!aliceCreateRes.ok) throw new Error(`Alice create failed: ${await aliceCreateRes.text()}`)

    // Add Alice's SSH key
    const aliceKeyRes = await fetch(`${idpBase}/api/admin/users/${encodeURIComponent(alice.email)}/ssh-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MGMT_TOKEN}` },
      body: JSON.stringify({ publicKey: alice.publicKeySsh, name: 'alice-key' }),
    })
    if (!aliceKeyRes.ok) throw new Error(`Alice key failed: ${await aliceKeyRes.text()}`)

    // Get Alice's JWT
    alice.jwt = await getJwtFor(alice, idpBase)
  })

  beforeEach(() => {
    logOutput = []
    stdoutOutput = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logOutput.push(args.map(String).join(' '))
    })
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stdoutOutput.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))
      return true
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    delete process.env.APES_IDP
    delete process.env.APES_MANAGEMENT_TOKEN
    await closeServer(server)
    rmSync(testHome, { recursive: true, force: true })
  })

  // ---------- Admin Users ----------
  describe('admin users', () => {
    it('lists users (includes Alice)', async () => {
      const { usersListCommand } = await import('../src/commands/admin/users')

      await usersListCommand.run!({ args: { json: true } } as any)

      const output = logOutput.join('\n')
      const result = JSON.parse(output)
      expect(result).toHaveProperty('data')
      expect(result).toHaveProperty('pagination')
      expect(Array.isArray(result.data)).toBe(true)
      expect(result.data.find((u: { email: string }) => u.email === 'alice@example.com')).toBeTruthy()
    })

    it('creates a user', async () => {
      const { usersCreateCommand } = await import('../src/commands/admin/users')
      const successSpy = vi.spyOn(consola, 'success')

      await usersCreateCommand.run!({ args: {
        email: 'dave@example.com',
        name: 'Dave',
      } } as any)

      expect(successSpy).toHaveBeenCalledWith(expect.stringContaining('dave@example.com'))
    })

    it('lists users (includes Dave)', async () => {
      const { usersListCommand } = await import('../src/commands/admin/users')

      await usersListCommand.run!({ args: { json: true } } as any)

      const output = logOutput.join('\n')
      const result = JSON.parse(output)
      expect(result.data.find((u: { email: string }) => u.email === 'dave@example.com')).toBeTruthy()
    })

    it('deletes a user', async () => {
      const { usersDeleteCommand } = await import('../src/commands/admin/users')
      const successSpy = vi.spyOn(consola, 'success')

      await usersDeleteCommand.run!({ args: { email: 'dave@example.com' } } as any)

      expect(successSpy).toHaveBeenCalledWith(expect.stringContaining('dave@example.com'))
    })

    it('lists users (Dave gone)', async () => {
      const { usersListCommand } = await import('../src/commands/admin/users')

      await usersListCommand.run!({ args: { json: true } } as any)

      const output = logOutput.join('\n')
      const result = JSON.parse(output)
      expect(result.data.find((u: { email: string }) => u.email === 'dave@example.com')).toBeUndefined()
    })

    it('human-readable list output', async () => {
      const { usersListCommand } = await import('../src/commands/admin/users')

      await usersListCommand.run!({ args: { json: false } } as any)

      const output = logOutput.join('\n')
      expect(output).toContain('alice@example.com')
      expect(output).toContain('Alice')
    })
  })

  // ---------- Admin SSH Keys ----------
  describe('admin ssh-keys', () => {
    const testUser = createTestUser('eve@example.com', 'Eve')
    let addedKeyId: string

    it('creates user Eve for key tests', async () => {
      const { usersCreateCommand } = await import('../src/commands/admin/users')
      await usersCreateCommand.run!({ args: { email: testUser.email, name: testUser.name } } as any)
    })

    it('adds an SSH key from string', async () => {
      const { sshKeysAddCommand } = await import('../src/commands/admin/ssh-keys')
      const successSpy = vi.spyOn(consola, 'success')

      await sshKeysAddCommand.run!({ args: {
        email: testUser.email,
        key: testUser.publicKeySsh,
        name: 'eve-key',
      } } as any)

      expect(successSpy).toHaveBeenCalled()
      const msg = successSpy.mock.calls[0]![0] as string
      expect(msg).toContain('SSH key added')
    })

    it('adds an SSH key from file', async () => {
      const newUser = createTestUser('file-key@example.com', 'FileKey')
      // Create the user first
      const { usersCreateCommand } = await import('../src/commands/admin/users')
      await usersCreateCommand.run!({ args: { email: newUser.email, name: newUser.name } } as any)

      // Write key to temp file
      const keyFile = join(testHome, 'test_key.pub')
      writeFileSync(keyFile, newUser.publicKeySsh)

      const { sshKeysAddCommand } = await import('../src/commands/admin/ssh-keys')
      const successSpy = vi.spyOn(consola, 'success')

      await sshKeysAddCommand.run!({ args: {
        email: newUser.email,
        key: keyFile,
        name: 'from-file',
      } } as any)

      expect(successSpy).toHaveBeenCalledWith(expect.stringContaining('SSH key added'))
    })

    it('lists SSH keys for Eve', async () => {
      const { sshKeysListCommand } = await import('../src/commands/admin/ssh-keys')

      await sshKeysListCommand.run!({ args: { email: testUser.email, json: true } } as any)

      const output = logOutput.join('\n')
      const keys = JSON.parse(output)
      expect(Array.isArray(keys)).toBe(true)
      expect(keys.length).toBeGreaterThanOrEqual(1)
      expect(keys[0].userEmail).toBe(testUser.email)
      addedKeyId = keys[0].keyId
    })

    it('human-readable list output', async () => {
      const { sshKeysListCommand } = await import('../src/commands/admin/ssh-keys')

      await sshKeysListCommand.run!({ args: { email: testUser.email, json: false } } as any)

      const output = logOutput.join('\n')
      expect(output).toContain(addedKeyId)
    })

    it('deletes an SSH key', async () => {
      const { sshKeysDeleteCommand } = await import('../src/commands/admin/ssh-keys')
      const successSpy = vi.spyOn(consola, 'success')

      await sshKeysDeleteCommand.run!({ args: {
        email: testUser.email,
        keyId: addedKeyId,
      } } as any)

      expect(successSpy).toHaveBeenCalledWith(expect.stringContaining(addedKeyId))
    })

    it('lists SSH keys after delete (empty)', async () => {
      const { sshKeysListCommand } = await import('../src/commands/admin/ssh-keys')
      const infoSpy = vi.spyOn(consola, 'info')

      await sshKeysListCommand.run!({ args: { email: testUser.email, json: false } } as any)

      expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('No SSH keys found'))
    })
  })

  // ---------- Delegation Revoke ----------
  describe('delegation-revoke', () => {
    let delegationId: string

    it('Alice creates a delegation via HTTP', async () => {
      const resp = await fetch(`${idpBase}/api/delegations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${alice.jwt}` },
        body: JSON.stringify({
          delegate: 'bob@example.com',
          audience: 'api.example.com',
          grant_type: 'once',
        }),
      })
      expect(resp.status).toBe(201)
      const result = await resp.json() as { id: string }
      delegationId = result.id
      expect(delegationId).toBeTruthy()
    })

    it('Alice revokes delegation via CLI', async () => {
      writeAuthAs(alice, idpBase)
      const { delegationRevokeCommand } = await import('../src/commands/grants/delegation-revoke')
      const successSpy = vi.spyOn(consola, 'success')

      await delegationRevokeCommand.run!({ args: { id: delegationId } } as any)

      expect(successSpy).toHaveBeenCalledWith(expect.stringContaining(delegationId))
    })

    it('delegation is revoked (validate returns invalid)', async () => {
      const resp = await fetch(`${idpBase}/api/delegations/${delegationId}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          delegate: 'bob@example.com',
          audience: 'api.example.com',
        }),
      })
      expect(resp.ok).toBe(true)
      const result = await resp.json() as { valid: boolean }
      expect(result.valid).toBe(false)
    })
  })

  // ---------- Error cases ----------
  describe('error handling', () => {
    it('admin commands fail without management token', async () => {
      const savedToken = process.env.APES_MANAGEMENT_TOKEN
      delete process.env.APES_MANAGEMENT_TOKEN

      const { usersListCommand } = await import('../src/commands/admin/users')

      await expect(
        usersListCommand.run!({ args: { json: true } } as any),
      ).rejects.toThrow('Management token required')

      process.env.APES_MANAGEMENT_TOKEN = savedToken
    })

    it('delete non-existent user returns 404', async () => {
      const { usersDeleteCommand } = await import('../src/commands/admin/users')

      await expect(
        usersDeleteCommand.run!({ args: { email: 'nonexistent@example.com' } } as any),
      ).rejects.toThrow()
    })

    it('delete non-existent SSH key returns 404', async () => {
      const { sshKeysDeleteCommand } = await import('../src/commands/admin/ssh-keys')

      await expect(
        sshKeysDeleteCommand.run!({ args: { email: 'alice@example.com', keyId: 'nonexistent' } } as any),
      ).rejects.toThrow()
    })
  })
})
