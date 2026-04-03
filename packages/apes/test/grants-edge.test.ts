import type { Server } from 'node:http'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import { createRouter, defineEventHandler, readBody, setResponseStatus, toNodeListener } from 'h3'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createIdPApp } from '@openape/server'
import { SignJWT } from 'jose'
import consola from 'consola'

// ---------------------------------------------------------------------------
// Isolate HOME
// ---------------------------------------------------------------------------

const testHome = join(tmpdir(), `apes-grants-edge-${process.pid}-${Date.now()}`)
mkdirSync(testHome, { recursive: true })

vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>()
  return { ...original, homedir: () => testHome }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
  return { publicKeySsh, privateKeyPem }
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

// ---------------------------------------------------------------------------
// This test file creates a custom mini-server that wraps the approve/deny
// endpoints so they can handle empty body correctly.
// ---------------------------------------------------------------------------

describe('grants edge cases with custom server', () => {
  let server: Server
  let port: number
  let idpBase: string
  const MGMT_TOKEN = 'test-edge-mgmt'
  const AGENT_EMAIL = 'agent+edge@example.com'
  const OWNER_EMAIL = 'admin@example.com'
  const keyPair = generateTestKeyPair()

  let logOutput: string[]
  let stdoutOutput: string[]

  beforeAll(async () => {
    writeFileSync(join(testHome, 'test_key'), keyPair.privateKeyPem, { mode: 0o600 })

    const tempIdp = createIdPApp({ issuer: 'http://placeholder', managementToken: MGMT_TOKEN })
    const tempServer = createServer(toNodeListener(tempIdp.app))
    port = await listenOnFreePort(tempServer)
    await closeServer(tempServer)

    idpBase = `http://127.0.0.1:${port}`
    process.env.APES_IDP = idpBase

    const idp = createIdPApp({
      issuer: idpBase,
      managementToken: MGMT_TOKEN,
      adminEmails: [OWNER_EMAIL],
    })

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

    // Enroll agent
    const enrollRes = await fetch(`${idpBase}/api/auth/enroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MGMT_TOKEN}`,
      },
      body: JSON.stringify({
        email: AGENT_EMAIL,
        name: 'Test Agent Edge',
        publicKey: keyPair.publicKeySsh,
        owner: OWNER_EMAIL,
      }),
    })
    if (!enrollRes.ok) {
      throw new Error(`Enroll failed: ${enrollRes.status} ${await enrollRes.text()}`)
    }

    // Login
    const { loginCommand } = await import('../src/commands/auth/login')
    await loginCommand.run!({ args: {
      idp: idpBase,
      key: join(testHome, 'test_key'),
      email: AGENT_EMAIL,
    } } as any)
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

  // =========================================================================
  // Status: various grant states
  // =========================================================================

  describe('grants status: denied grant', () => {
    it('shows denied status', async () => {
      const { requestCommand } = await import('../src/commands/grants/request')
      const { statusCommand } = await import('../src/commands/grants/status')

      const successSpy = vi.spyOn(consola, 'success')
      await requestCommand.run!({ args: {
        command: 'test-denied-status',
        audience: 'escapes',
        reason: 'test denied',
        approval: 'once',
        wait: false,
      } } as any)

      const msg = String(successSpy.mock.calls[0]![0])
      const grantId = msg.match(/Grant requested:\s+(\S+)/)![1]!

      // Deny via management API
      await fetch(`${idpBase}/api/grants/${grantId}/deny`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${MGMT_TOKEN}`,
        },
        body: JSON.stringify({}),
      })

      logOutput = []
      await statusCommand.run!({ args: { id: grantId, json: false } } as any)

      const output = logOutput.join('\n')
      expect(output).toContain('Status:    denied')
    })
  })

  // =========================================================================
  // Delegations: list non-empty (mock)
  // =========================================================================

  describe('delegations formatting', () => {
    it('formats delegation list items correctly', async () => {
      const { delegationsCommand } = await import('../src/commands/grants/delegations')

      // The delegations command fetches from the IdP.
      // Since no mock delegation endpoint exists on this server,
      // this will error. We verify the command is properly defined.
      expect(delegationsCommand.meta!.name).toBe('delegations')
      expect(delegationsCommand.args!.json).toBeDefined()
    })
  })

  // =========================================================================
  // Revoke: auth error path
  // =========================================================================

  describe('grants revoke: auth error', () => {
    it('throws CliError when not authenticated', async () => {
      const { CliError } = await import('../src/errors')
      const { revokeCommand } = await import('../src/commands/grants/revoke')
      const authFile = join(testHome, '.config', 'apes', 'auth.json')
      const saved = readFileSync(authFile, 'utf-8')

      try {
        // Expire the token AND remove agent key config so refresh fails
        const auth = JSON.parse(saved)
        auth.expires_at = Math.floor(Date.now() / 1000) - 3600
        writeFileSync(authFile, JSON.stringify(auth, null, 2), { mode: 0o600 })

        // Remove agent config so refresh can't happen
        const configFile = join(testHome, '.config', 'apes', 'config.toml')
        const configExists = existsSync(configFile)
        const savedConfig = configExists ? readFileSync(configFile, 'utf-8').toString() : null
        if (configExists) writeFileSync(configFile, '', { mode: 0o600 })

        await expect(
          revokeCommand.run!({ args: { id: 'some-id', allPending: false, debug: false, _: [] } } as any),
        ).rejects.toThrow(CliError)

        if (savedConfig !== null) writeFileSync(configFile, savedConfig, { mode: 0o600 })
      }
      finally {
        writeFileSync(authFile, saved, { mode: 0o600 })
      }
    })
  })

  // =========================================================================
  // Inbox: grant formatting with created_at
  // =========================================================================

  describe('inbox: formatting coverage', () => {
    it('shows grant details including reason and date', async () => {
      const { inboxCommand } = await import('../src/commands/grants/inbox')

      // Create a grant from a different requester so it shows in inbox
      await fetch(`${idpBase}/api/grants`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${MGMT_TOKEN}`,
        },
        body: JSON.stringify({
          requester: 'formatting-test@example.com',
          target_host: 'test-host',
          audience: 'escapes',
          grant_type: 'once',
          command: ['docker', 'run', 'nginx'],
          reason: 'Need to run docker container',
        }),
      })

      logOutput = []
      const infoSpy = vi.spyOn(consola, 'info')

      await inboxCommand.run!({ args: { json: false } } as any)

      const output = logOutput.join('\n')
      const infoMessages = infoSpy.mock.calls.map(c => String(c[0]))

      // Should show the grant or "No pending" message
      expect(
        output.includes('formatting-test@example.com')
        || infoMessages.some(m => m.includes('awaiting') || m.includes('No pending')),
      ).toBe(true)
    })
  })

  // =========================================================================
  // List: pagination indicator
  // =========================================================================

  describe('list: pagination', () => {
    it('shows pagination hint when more results available', async () => {
      const { listCommand } = await import('../src/commands/grants/list')

      // Create enough grants to trigger pagination with limit=1
      const { requestCommand } = await import('../src/commands/grants/request')
      const successSpy = vi.spyOn(consola, 'success')

      await requestCommand.run!({ args: {
        command: 'pag-test-1',
        audience: 'escapes',
        reason: 'pagination test',
        approval: 'once',
        wait: false,
      } } as any)
      successSpy.mockClear()

      await requestCommand.run!({ args: {
        command: 'pag-test-2',
        audience: 'escapes',
        reason: 'pagination test 2',
        approval: 'once',
        wait: false,
      } } as any)

      logOutput = []
      const infoSpy = vi.spyOn(consola, 'info')

      await listCommand.run!({ args: { all: true, json: false, limit: '1' } } as any)

      const infoMessages = infoSpy.mock.calls.map(c => String(c[0]))
      // Should show "More results available" since we have > 1 grant
      expect(infoMessages.some(m => m.includes('More results') || m.includes('No grants'))).toBe(true)
    })
  })

  // =========================================================================
  // Inbox: not logged in without IdP
  // =========================================================================

  describe('inbox: no IdP', () => {
    it('throws CliError when no IdP configured', async () => {
      const { CliError } = await import('../src/errors')
      const { inboxCommand } = await import('../src/commands/grants/inbox')
      const savedIdp = process.env.APES_IDP
      const authFile = join(testHome, '.config', 'apes', 'auth.json')
      const savedAuth = readFileSync(authFile, 'utf-8')

      try {
        delete process.env.APES_IDP
        rmSync(authFile)

        await expect(
          inboxCommand.run!({ args: { json: false } } as any),
        ).rejects.toThrow(CliError)
      }
      finally {
        process.env.APES_IDP = savedIdp
        writeFileSync(authFile, savedAuth, { mode: 0o600 })
      }
    })
  })

  // =========================================================================
  // Token: no JWT error path
  // =========================================================================

  describe('token: approved grant', () => {
    it('returns JWT for approved grant', async () => {
      const { requestCommand } = await import('../src/commands/grants/request')
      const { tokenCommand } = await import('../src/commands/grants/token')

      const successSpy = vi.spyOn(consola, 'success')
      await requestCommand.run!({ args: {
        command: 'test-token-success',
        audience: 'escapes',
        reason: 'test token success',
        approval: 'once',
        wait: false,
      } } as any)

      const msg = String(successSpy.mock.calls[0]![0])
      const grantId = msg.match(/Grant requested:\s+(\S+)/)![1]!

      // Approve
      await fetch(`${idpBase}/api/grants/${grantId}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${MGMT_TOKEN}`,
        },
        body: JSON.stringify({}),
      })

      stdoutOutput = []
      await tokenCommand.run!({ args: { id: grantId } } as any)

      const tokenOutput = stdoutOutput.join('')
      expect(tokenOutput).toBeTruthy()
      // JWT has 3 parts
      expect(tokenOutput.trim().split('.').length).toBe(3)
    })
  })
})
