import type { Server } from 'node:http'
import type { KeyObject } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'
import { createRouter, defineEventHandler, readBody, setResponseStatus, toNodeListener } from 'h3'
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createIdPApp } from '@openape/server'
import { SignJWT } from 'jose'
import consola from 'consola'

// ---------------------------------------------------------------------------
// Isolate HOME to a single tmpdir (config.ts computes AUTH_FILE once at import)
// ---------------------------------------------------------------------------

const testHome = join(tmpdir(), `apes-workflows-${process.pid}-${Date.now()}`)
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

/**
 * Write auth.json for a specific user so apes commands act as that user.
 * Since config.ts computes the file path once at module-load, all users
 * share the same auth file. We swap its content before each operation.
 */
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

/**
 * Get a JWT for a user via challenge-response against the compat endpoint.
 */
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

/**
 * Approve a grant via direct HTTP.
 */
async function approveGrantHttp(grantId: string, token: string, idpBase: string, overrides?: Record<string, unknown>) {
  const resp = await fetch(`${idpBase}/api/grants/${grantId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(overrides ?? {}),
  })
  if (!resp.ok) throw new Error(`Approve failed: ${resp.status} ${await resp.text()}`)
  return resp.json() as Promise<{ grant: { status: string } }>
}

/**
 * Deny a grant via direct HTTP.
 */
async function denyGrantHttp(grantId: string, token: string, idpBase: string) {
  const resp = await fetch(`${idpBase}/api/grants/${grantId}/deny`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({}),
  })
  if (!resp.ok) throw new Error(`Deny failed: ${resp.status} ${await resp.text()}`)
  return resp.json()
}

/**
 * Revoke a grant via management token.
 */
async function revokeGrantMgmt(grantId: string, mgmtToken: string, idpBase: string) {
  const resp = await fetch(`${idpBase}/api/grants/${grantId}/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mgmtToken}` },
    body: JSON.stringify({}),
  })
  if (!resp.ok) throw new Error(`Revoke failed: ${resp.status} ${await resp.text()}`)
  return resp.json()
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('multi-user workflow tests', () => {
  let server: Server
  let port: number
  let idpBase: string
  const MGMT_TOKEN = 'test-mgmt-token-workflows'

  let alice: TestUser
  let bob: TestUser
  let charlie: TestUser

  // Capture output
  let logOutput: string[]
  let stdoutOutput: string[]

  beforeAll(async () => {
    // Create users with keypairs
    alice = createTestUser('alice@example.com', 'Alice')
    bob = createTestUser('bob@example.com', 'Bob')
    charlie = createTestUser('charlie@example.com', 'Charlie')

    // Write Bob's private key to testHome for login test
    writeFileSync(join(testHome, 'bob_key'), bob.privateKeyPem, { mode: 0o600 })

    // ---- Start IdP ----
    const tempIdp = createIdPApp({ issuer: 'http://placeholder', managementToken: MGMT_TOKEN })
    const tempServer = createServer(toNodeListener(tempIdp.app))
    port = await listenOnFreePort(tempServer)
    await closeServer(tempServer)

    idpBase = `http://127.0.0.1:${port}`
    process.env.APES_IDP = idpBase

    const idp = createIdPApp({
      issuer: idpBase,
      managementToken: MGMT_TOKEN,
      adminEmails: ['alice@example.com'],
    })

    // ---- Compat routes for agent_id -> id field mapping ----
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

    // ---- Register Alice as human admin ----
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

    // ---- Enroll Bob as agent owned by Alice ----
    const bobEnrollRes = await fetch(`${idpBase}/api/auth/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MGMT_TOKEN}` },
      body: JSON.stringify({ email: bob.email, name: bob.name, publicKey: bob.publicKeySsh, owner: alice.email }),
    })
    if (!bobEnrollRes.ok) throw new Error(`Bob enroll failed: ${await bobEnrollRes.text()}`)

    // ---- Enroll Charlie as agent owned by Alice ----
    const charlieEnrollRes = await fetch(`${idpBase}/api/auth/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MGMT_TOKEN}` },
      body: JSON.stringify({ email: charlie.email, name: charlie.name, publicKey: charlie.publicKeySsh, owner: alice.email }),
    })
    if (!charlieEnrollRes.ok) throw new Error(`Charlie enroll failed: ${await charlieEnrollRes.text()}`)

    // ---- Get JWTs for all users ----
    alice.jwt = await getJwtFor(alice, idpBase)
    bob.jwt = await getJwtFor(bob, idpBase)
    charlie.jwt = await getJwtFor(charlie, idpBase)
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
    await closeServer(server)
    rmSync(testHome, { recursive: true, force: true })
  })

  // ---------- Scenario 0: Login with SSH key ----------
  it('Bob logs in via apes login --key', async () => {
    const { loginCommand } = await import('../src/commands/auth/login')

    await loginCommand.run!({ args: {
      idp: idpBase,
      key: join(testHome, 'bob_key'),
      email: bob.email,
    } } as any)

    // Verify auth was written correctly
    const { readFileSync, existsSync } = await import('node:fs')
    const authFile = join(testHome, '.config', 'apes', 'auth.json')
    expect(existsSync(authFile)).toBe(true)
    const auth = JSON.parse(readFileSync(authFile, 'utf-8'))
    expect(auth.email).toBe(bob.email)
    expect(auth.access_token).toBeTruthy()
  })

  // ---------- Scenario 1: Agent onboarding + Grant lifecycle ----------
  describe('scenario 1: agent onboarding + grant lifecycle', () => {
    let grantId: string

    it('Bob requests a grant', async () => {
      writeAuthAs(bob, idpBase)
      const { requestCommand } = await import('../src/commands/grants/request')
      const successSpy = vi.spyOn(consola, 'success')

      await requestCommand.run!({ args: {
        command: 'ls -la',
        audience: 'escapes',
        reason: 'integration test',
        approval: 'once',
        wait: false,
      } } as any)

      expect(successSpy).toHaveBeenCalled()
      const successMsg = successSpy.mock.calls[0]![0] as string
      const idMatch = successMsg.match(/Grant requested:\s+(\S+)/)
      expect(idMatch).toBeTruthy()
      grantId = idMatch![1]!
    })

    it('Alice approves the grant', async () => {
      const result = await approveGrantHttp(grantId, alice.jwt!, idpBase)
      expect(result.grant.status).toBe('approved')
    })

    it('Bob gets the grant token with correct JWT claims', async () => {
      writeAuthAs(bob, idpBase)
      const { tokenCommand } = await import('../src/commands/grants/token')

      await tokenCommand.run!({ args: { id: grantId } } as any)

      const tokenOutput = stdoutOutput.join('')
      expect(tokenOutput).toBeTruthy()
      const jwtParts = tokenOutput.trim().split('.')
      expect(jwtParts.length).toBe(3)

      const payload = JSON.parse(Buffer.from(jwtParts[1]!, 'base64url').toString())
      expect(payload.grant_id).toBe(grantId)
      expect(payload.sub).toBe(bob.email)
      expect(payload.aud).toBe('escapes')
    })

    it('Bob checks grant status -- approved', async () => {
      writeAuthAs(bob, idpBase)
      const { statusCommand } = await import('../src/commands/grants/status')

      await statusCommand.run!({ args: { id: grantId, json: true } } as any)

      const output = logOutput.join('\n')
      const data = JSON.parse(output)
      expect(data.status).toBe('approved')
    })

    it('Alice revokes the grant', async () => {
      await revokeGrantMgmt(grantId, MGMT_TOKEN, idpBase)
    })

    it('Bob checks grant status -- revoked', async () => {
      writeAuthAs(bob, idpBase)
      logOutput = []
      const { statusCommand } = await import('../src/commands/grants/status')

      await statusCommand.run!({ args: { id: grantId, json: true } } as any)

      const output = logOutput.join('\n')
      const data = JSON.parse(output)
      expect(data.status).toBe('revoked')
    })
  })

  // ---------- Scenario 2: Grant denial ----------
  describe('scenario 2: grant denial', () => {
    let grantId: string

    it('Bob requests a grant', async () => {
      writeAuthAs(bob, idpBase)
      const { requestCommand } = await import('../src/commands/grants/request')
      const successSpy = vi.spyOn(consola, 'success')

      await requestCommand.run!({ args: {
        command: 'rm -rf /tmp/test',
        audience: 'escapes',
        reason: 'test denial',
        approval: 'once',
        wait: false,
      } } as any)

      const successMsg = successSpy.mock.calls[0]![0] as string
      const idMatch = successMsg.match(/Grant requested:\s+(\S+)/)
      expect(idMatch).toBeTruthy()
      grantId = idMatch![1]!
    })

    it('Alice denies the grant', async () => {
      await denyGrantHttp(grantId, alice.jwt!, idpBase)
    })

    it('Bob checks status -- denied', async () => {
      writeAuthAs(bob, idpBase)
      const { statusCommand } = await import('../src/commands/grants/status')

      await statusCommand.run!({ args: { id: grantId, json: true } } as any)

      const output = logOutput.join('\n')
      const data = JSON.parse(output)
      expect(data.status).toBe('denied')
    })

    it('grant token request fails for denied grant', async () => {
      writeAuthAs(bob, idpBase)
      const { tokenCommand } = await import('../src/commands/grants/token')

      await expect(
        tokenCommand.run!({ args: { id: grantId } } as any),
      ).rejects.toThrow()
    })
  })

  // ---------- Scenario 3: Timed grant ----------
  describe('scenario 3: timed grant reuse', () => {
    let grantId: string

    it('Bob requests a timed grant', async () => {
      writeAuthAs(bob, idpBase)
      const { requestCommand } = await import('../src/commands/grants/request')
      const successSpy = vi.spyOn(consola, 'success')

      await requestCommand.run!({ args: {
        command: 'docker ps',
        audience: 'escapes',
        reason: 'timed session test',
        approval: 'timed',
        duration: '1h',
        wait: false,
      } } as any)

      const successMsg = successSpy.mock.calls[0]![0] as string
      const idMatch = successMsg.match(/Grant requested:\s+(\S+)/)
      expect(idMatch).toBeTruthy()
      grantId = idMatch![1]!
    })

    it('Alice approves with timed duration', async () => {
      const result = await approveGrantHttp(grantId, alice.jwt!, idpBase, {
        grant_type: 'timed',
        duration: 3600,
      })
      expect(result.grant.status).toBe('approved')
    })

    it('Bob gets the token -- succeeds', async () => {
      writeAuthAs(bob, idpBase)
      const { tokenCommand } = await import('../src/commands/grants/token')

      await tokenCommand.run!({ args: { id: grantId } } as any)

      const tokenOutput = stdoutOutput.join('')
      expect(tokenOutput).toBeTruthy()
      const jwtParts = tokenOutput.trim().split('.')
      expect(jwtParts.length).toBe(3)
    })

    it('grant is still active', async () => {
      writeAuthAs(bob, idpBase)
      const { statusCommand } = await import('../src/commands/grants/status')

      await statusCommand.run!({ args: { id: grantId, json: true } } as any)

      const output = logOutput.join('\n')
      const data = JSON.parse(output)
      expect(data.status).toBe('approved')
    })
  })

  // ---------- Scenario 4: Batch revoke ----------
  describe('scenario 4: batch revoke', () => {
    const grantIds: string[] = []

    it('Bob creates 3 pending grants', async () => {
      writeAuthAs(bob, idpBase)
      const { requestCommand } = await import('../src/commands/grants/request')

      for (let i = 0; i < 3; i++) {
        const successSpy = vi.spyOn(consola, 'success')
        await requestCommand.run!({ args: {
          command: `test-cmd-${i}`,
          audience: 'escapes',
          reason: `batch test ${i}`,
          approval: 'once',
          wait: false,
        } } as any)

        const successMsg = successSpy.mock.calls.at(-1)![0] as string
        const idMatch = successMsg.match(/Grant requested:\s+(\S+)/)
        expect(idMatch).toBeTruthy()
        grantIds.push(idMatch![1]!)
        successSpy.mockRestore()
      }

      expect(grantIds.length).toBe(3)
    })

    it('Bob revokes all pending via --all-pending', async () => {
      writeAuthAs(bob, idpBase)
      const { revokeCommand } = await import('../src/commands/grants/revoke')
      const successSpy = vi.spyOn(consola, 'success')

      await revokeCommand.run!({ args: {
        allPending: true,
        debug: false,
        _: [],
      } } as any)

      expect(successSpy).toHaveBeenCalled()
    })

    it('all 3 grants are revoked', async () => {
      writeAuthAs(bob, idpBase)
      const { statusCommand } = await import('../src/commands/grants/status')

      for (const id of grantIds) {
        logOutput = []
        await statusCommand.run!({ args: { id, json: true } } as any)
        const output = logOutput.join('\n')
        const data = JSON.parse(output)
        expect(data.status).toBe('revoked')
      }
    })
  })

  // ---------- Scenario 5: Grant inbox ----------
  describe('scenario 5: grant inbox', () => {
    let grantId: string

    it('Bob creates a grant request', async () => {
      writeAuthAs(bob, idpBase)
      const { requestCommand } = await import('../src/commands/grants/request')
      const successSpy = vi.spyOn(consola, 'success')

      await requestCommand.run!({ args: {
        command: 'cat /etc/shadow',
        audience: 'escapes',
        reason: 'inbox test',
        approval: 'once',
        wait: false,
      } } as any)

      const successMsg = successSpy.mock.calls[0]![0] as string
      const idMatch = successMsg.match(/Grant requested:\s+(\S+)/)
      expect(idMatch).toBeTruthy()
      grantId = idMatch![1]!
    })

    it('Alice checks inbox -- sees Bob\'s request', async () => {
      writeAuthAs(alice, idpBase)
      const { inboxCommand } = await import('../src/commands/grants/inbox')

      await inboxCommand.run!({ args: { json: true } } as any)

      const output = logOutput.join('\n')
      const data = JSON.parse(output)
      // The server returns grants with requester nested under request.requester
      const pending = data.data.filter((g: { request?: { requester?: string } }) =>
        g.request?.requester === bob.email,
      )
      expect(pending.length).toBeGreaterThanOrEqual(1)
      const ourGrant = pending.find((g: { id: string }) => g.id === grantId)
      expect(ourGrant).toBeTruthy()
    })

    it('Alice approves, then inbox is empty of that grant', async () => {
      await approveGrantHttp(grantId, alice.jwt!, idpBase)

      writeAuthAs(alice, idpBase)
      logOutput = []
      const { inboxCommand } = await import('../src/commands/grants/inbox')

      await inboxCommand.run!({ args: { json: true } } as any)

      const output = logOutput.join('\n')
      const data = JSON.parse(output)
      const ourGrant = data.data.find((g: { id: string }) => g.id === grantId)
      expect(ourGrant).toBeUndefined()
    })
  })

  // ---------- Scenario 6: Cross-user grant visibility ----------
  describe('scenario 6: cross-user grant visibility', () => {
    let bobGrantId: string
    let charlieGrantId: string

    it('Bob and Charlie each request a grant', async () => {
      // Bob's grant
      writeAuthAs(bob, idpBase)
      const { requestCommand } = await import('../src/commands/grants/request')
      let successSpy = vi.spyOn(consola, 'success')

      await requestCommand.run!({ args: {
        command: 'whoami',
        audience: 'escapes',
        reason: 'bob visibility test',
        approval: 'once',
        wait: false,
      } } as any)

      let successMsg = successSpy.mock.calls[0]![0] as string
      let idMatch = successMsg.match(/Grant requested:\s+(\S+)/)
      expect(idMatch).toBeTruthy()
      bobGrantId = idMatch![1]!
      successSpy.mockRestore()

      // Charlie's grant
      writeAuthAs(charlie, idpBase)
      successSpy = vi.spyOn(consola, 'success')

      await requestCommand.run!({ args: {
        command: 'hostname',
        audience: 'escapes',
        reason: 'charlie visibility test',
        approval: 'once',
        wait: false,
      } } as any)

      successMsg = successSpy.mock.calls[0]![0] as string
      idMatch = successMsg.match(/Grant requested:\s+(\S+)/)
      expect(idMatch).toBeTruthy()
      charlieGrantId = idMatch![1]!
    })

    it('Alice sees both agents\' grants (as owner)', async () => {
      writeAuthAs(alice, idpBase)
      const { listCommand } = await import('../src/commands/grants/list')

      await listCommand.run!({ args: { all: true, json: true } } as any)

      const output = logOutput.join('\n')
      const data = JSON.parse(output)
      const ids = data.data.map((g: { id: string }) => g.id)
      expect(ids).toContain(bobGrantId)
      expect(ids).toContain(charlieGrantId)
    })
  })

  // ---------- Scenario 7: Delegation ----------
  describe('scenario 7: delegation', () => {
    let delegationId: string

    it('Alice creates a delegation for Charlie at api.example.com', async () => {
      writeAuthAs(alice, idpBase)
      const { delegateCommand } = await import('../src/commands/grants/delegate')
      const successSpy = vi.spyOn(consola, 'success')

      await delegateCommand.run!({ args: {
        to: 'charlie@example.com',
        at: 'api.example.com',
        approval: 'once',
      } } as any)

      expect(successSpy).toHaveBeenCalled()
      const successMsg = successSpy.mock.calls[0]![0] as string
      const idMatch = successMsg.match(/Delegation created:\s+(\S+)/)
      expect(idMatch).toBeTruthy()
      delegationId = idMatch![1]!
    })

    it('Alice lists delegations -- sees her delegation', async () => {
      writeAuthAs(alice, idpBase)
      const { delegationsCommand } = await import('../src/commands/grants/delegations')

      await delegationsCommand.run!({ args: { json: true } } as any)

      const output = logOutput.join('\n')
      const delegations = JSON.parse(output)
      expect(Array.isArray(delegations)).toBe(true)
      const found = delegations.find((d: { id: string }) => d.id === delegationId)
      expect(found).toBeTruthy()
      expect(found.request.delegator).toBe(alice.email)
      expect(found.request.delegate).toBe(charlie.email)
      expect(found.request.audience).toBe('api.example.com')
    })

    it('Charlie lists delegations -- sees the delegation as delegate', async () => {
      writeAuthAs(charlie, idpBase)
      logOutput = []
      const { delegationsCommand } = await import('../src/commands/grants/delegations')

      await delegationsCommand.run!({ args: { json: true } } as any)

      const output = logOutput.join('\n')
      const delegations = JSON.parse(output)
      expect(Array.isArray(delegations)).toBe(true)
      const found = delegations.find((d: { id: string }) => d.id === delegationId)
      expect(found).toBeTruthy()
    })

    it('Bob lists delegations -- does not see the delegation', async () => {
      writeAuthAs(bob, idpBase)
      logOutput = []
      const { delegationsCommand } = await import('../src/commands/grants/delegations')

      await delegationsCommand.run!({ args: { json: true } } as any)

      const output = logOutput.join('\n')
      const delegations = JSON.parse(output)
      expect(Array.isArray(delegations)).toBe(true)
      const found = delegations.find((d: { id: string }) => d.id === delegationId)
      expect(found).toBeUndefined()
    })

    it('Agent Bob cannot create a delegation (403)', async () => {
      writeAuthAs(bob, idpBase)
      const { delegateCommand } = await import('../src/commands/grants/delegate')

      await expect(
        delegateCommand.run!({ args: {
          to: 'alice@example.com',
          at: 'api.example.com',
          approval: 'once',
        } } as any),
      ).rejects.toThrow()
    })

    it('Alice revokes the delegation', async () => {
      const resp = await fetch(`${idpBase}/api/delegations/${delegationId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${alice.jwt}` },
      })
      expect(resp.ok).toBe(true)
      const result = await resp.json() as { status: string }
      expect(result.status).toBe('revoked')
    })

    it('Alice lists delegations -- revoked delegation no longer appears', async () => {
      writeAuthAs(alice, idpBase)
      logOutput = []
      const { delegationsCommand } = await import('../src/commands/grants/delegations')

      await delegationsCommand.run!({ args: { json: true } } as any)

      const output = logOutput.join('\n')
      const delegations = JSON.parse(output)
      // The revoked delegation should not show in the list because
      // findByDelegator/findByDelegate only return active delegations,
      // or if it does appear, it should be revoked
      const found = delegations.find((d: { id: string }) => d.id === delegationId)
      if (found) {
        expect(found.status).toBe('revoked')
      }
    })

    it('validate endpoint confirms revoked delegation is invalid', async () => {
      const resp = await fetch(`${idpBase}/api/delegations/${delegationId}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          delegate: charlie.email,
          audience: 'api.example.com',
        }),
      })
      expect(resp.ok).toBe(true)
      const result = await resp.json() as { valid: boolean }
      expect(result.valid).toBe(false)
    })
  })
})
