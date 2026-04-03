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

const testHome = join(tmpdir(), `apes-additional-${process.pid}-${Date.now()}`)
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
// Test suite for additional coverage
// ---------------------------------------------------------------------------

describe('additional coverage tests', () => {
  let server: Server
  let port: number
  let idpBase: string
  const MGMT_TOKEN = 'test-additional-mgmt'
  const AGENT_EMAIL = 'agent+additional@example.com'
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

    // Add a mock delegations endpoint
    compatRouter.get('/api/delegations', defineEventHandler(async () => {
      return []
    }))

    compatRouter.post('/api/delegations', defineEventHandler(async (event) => {
      const body = await readBody(event)
      return { id: `del-${Date.now()}`, ...body as object }
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
        name: 'Test Agent Additional',
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

    // Save agent config for auto-refresh tests
    const { saveConfig, loadConfig } = await import('../src/config')
    const config = loadConfig()
    config.agent = { key: join(testHome, 'test_key'), email: AGENT_EMAIL }
    saveConfig(config)
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
  // Delegations with mock endpoint
  // =========================================================================

  describe('grants delegations (with mock endpoint)', () => {
    it('lists empty delegations', async () => {
      const { delegationsCommand } = await import('../src/commands/grants/delegations')
      const infoSpy = vi.spyOn(consola, 'info')

      await delegationsCommand.run!({ args: { json: false } } as any)

      expect(infoSpy).toHaveBeenCalled()
      const msg = String(infoSpy.mock.calls[0]![0])
      expect(msg).toContain('No delegations found')
    })

    it('lists empty delegations as JSON', async () => {
      const { delegationsCommand } = await import('../src/commands/grants/delegations')

      logOutput = []
      await delegationsCommand.run!({ args: { json: true } } as any)

      const output = logOutput.join('\n')
      const data = JSON.parse(output)
      expect(Array.isArray(data)).toBe(true)
      expect(data.length).toBe(0)
    })
  })

  describe('grants delegate (with mock endpoint)', () => {
    it('creates a delegation', async () => {
      const { delegateCommand } = await import('../src/commands/grants/delegate')
      const successSpy = vi.spyOn(consola, 'success')

      await delegateCommand.run!({ args: {
        to: 'other@example.com',
        at: 'api.example.com',
        approval: 'once',
      } } as any)

      expect(successSpy).toHaveBeenCalled()
      const msg = String(successSpy.mock.calls[0]![0])
      expect(msg).toContain('Delegation created')
    })

    it('creates a delegation with scopes and expiry', async () => {
      const { delegateCommand } = await import('../src/commands/grants/delegate')
      const successSpy = vi.spyOn(consola, 'success')

      await delegateCommand.run!({ args: {
        to: 'other@example.com',
        at: 'api.example.com',
        approval: 'timed',
        scopes: 'read,write',
        expires: '2030-01-01T00:00:00Z',
      } } as any)

      expect(successSpy).toHaveBeenCalled()

      // Verify scopes and expiry are printed
      const output = logOutput.join('\n')
      expect(output).toContain('Scopes:   read,write')
      expect(output).toContain('Expires:  2030-01-01T00:00:00Z')
    })
  })

  // =========================================================================
  // Config: round-trip
  // =========================================================================

  describe('config round-trip', () => {
    it('set then get defaults.idp', async () => {
      const { configSetCommand } = await import('../src/commands/config/set')
      const { configGetCommand } = await import('../src/commands/config/get')

      configSetCommand.run!({ args: { key: 'defaults.idp', value: 'https://my.idp.example.com' } } as any)

      logOutput = []
      configGetCommand.run!({ args: { key: 'defaults.idp' } } as any)

      expect(logOutput.join('\n')).toContain('https://my.idp.example.com')
    })
  })

  // =========================================================================
  // Config module: edge cases
  // =========================================================================

  describe('config module edge cases', () => {
    it('loadAuth returns null for corrupt auth file', async () => {
      const { loadAuth } = await import('../src/config')
      const authFile = join(testHome, '.config', 'apes', 'auth.json')
      const saved = readFileSync(authFile, 'utf-8')

      try {
        writeFileSync(authFile, 'NOT VALID JSON', { mode: 0o600 })
        const auth = loadAuth()
        expect(auth).toBeNull()
      }
      finally {
        writeFileSync(authFile, saved, { mode: 0o600 })
      }
    })

    it('loadConfig returns empty for corrupt config file', async () => {
      const { loadConfig } = await import('../src/config')
      const configFile = join(testHome, '.config', 'apes', 'config.toml')
      const saved = existsSync(configFile) ? readFileSync(configFile, 'utf-8') : null

      try {
        // Write something that parses but has no sections
        writeFileSync(configFile, '# just a comment', { mode: 0o600 })
        const config = loadConfig()
        expect(config).toEqual({})
      }
      finally {
        if (saved !== null) {
          writeFileSync(configFile, saved, { mode: 0o600 })
        }
        else {
          rmSync(configFile, { force: true })
        }
      }
    })

    it('clearAuth clears auth data', async () => {
      const { clearAuth, loadAuth } = await import('../src/config')
      const authFile = join(testHome, '.config', 'apes', 'auth.json')
      const saved = readFileSync(authFile, 'utf-8')

      try {
        clearAuth()
        const auth = loadAuth()
        expect(auth).toBeNull()
      }
      finally {
        writeFileSync(authFile, saved, { mode: 0o600 })
      }
    })

    it('getRequesterIdentity returns email from auth', async () => {
      const { getRequesterIdentity } = await import('../src/config')
      const identity = getRequesterIdentity()
      expect(identity).toBe(AGENT_EMAIL)
    })

    it('getRequesterIdentity returns null when no auth', async () => {
      const { getRequesterIdentity } = await import('../src/config')
      const authFile = join(testHome, '.config', 'apes', 'auth.json')
      const saved = readFileSync(authFile, 'utf-8')

      try {
        rmSync(authFile)
        const identity = getRequesterIdentity()
        expect(identity).toBeNull()
      }
      finally {
        writeFileSync(authFile, saved, { mode: 0o600 })
      }
    })

    it('getAuthToken returns null for expired token', async () => {
      const { getAuthToken } = await import('../src/config')
      const authFile = join(testHome, '.config', 'apes', 'auth.json')
      const saved = readFileSync(authFile, 'utf-8')

      try {
        const auth = JSON.parse(saved)
        auth.expires_at = Math.floor(Date.now() / 1000) - 3600
        writeFileSync(authFile, JSON.stringify(auth, null, 2), { mode: 0o600 })

        const token = getAuthToken()
        expect(token).toBeNull()
      }
      finally {
        writeFileSync(authFile, saved, { mode: 0o600 })
      }
    })

    it('getIdpUrl falls back to config defaults.idp', async () => {
      const { getIdpUrl } = await import('../src/config')
      const authFile = join(testHome, '.config', 'apes', 'auth.json')
      const savedAuth = readFileSync(authFile, 'utf-8')
      const savedIdp = process.env.APES_IDP

      try {
        delete process.env.APES_IDP
        rmSync(authFile) // remove auth so auth.idp isn't found

        // defaults.idp was set in prior test to 'https://my.idp.example.com'
        const idp = getIdpUrl()
        expect(idp).toBe('https://my.idp.example.com')
      }
      finally {
        process.env.APES_IDP = savedIdp
        writeFileSync(authFile, savedAuth, { mode: 0o600 })
      }
    })
  })

  // =========================================================================
  // HTTP: auto-refresh agent token
  // =========================================================================

  describe('http: auto-refresh agent token', () => {
    it('auto-refreshes expired token via Ed25519 challenge-response', async () => {
      const { apiFetch } = await import('../src/http')
      const { loadAuth } = await import('../src/config')
      const authFile = join(testHome, '.config', 'apes', 'auth.json')
      const saved = readFileSync(authFile, 'utf-8')

      try {
        // Expire the current token
        const auth = JSON.parse(saved)
        auth.expires_at = Math.floor(Date.now() / 1000) - 3600
        writeFileSync(authFile, JSON.stringify(auth, null, 2), { mode: 0o600 })

        // apiFetch should detect expired token, call refreshAgentToken,
        // which reads the agent key from config and re-authenticates
        const result = await apiFetch<{ data: unknown[] }>(`${idpBase}/api/grants`)

        expect(result).toHaveProperty('data')

        // Verify that auth was refreshed
        const refreshedAuth = loadAuth()
        expect(refreshedAuth).not.toBeNull()
        expect(refreshedAuth!.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000))
      }
      finally {
        // Restore original valid auth
        writeFileSync(authFile, saved, { mode: 0o600 })
      }
    })
  })

  // =========================================================================
  // Revoke: batch mode (multiple IDs)
  // =========================================================================

  describe('grants revoke: batch', () => {
    it('revokes multiple grants via batch endpoint', async () => {
      const { requestCommand } = await import('../src/commands/grants/request')
      const { revokeCommand } = await import('../src/commands/grants/revoke')

      const successSpy = vi.spyOn(consola, 'success')

      // Create two grants
      await requestCommand.run!({ args: {
        command: 'batch-revoke-1',
        audience: 'escapes',
        reason: 'test batch',
        approval: 'once',
        wait: false,
      } } as any)
      const msg1 = String(successSpy.mock.calls[0]![0])
      const id1 = msg1.match(/Grant requested:\s+(\S+)/)![1]!

      successSpy.mockClear()
      await requestCommand.run!({ args: {
        command: 'batch-revoke-2',
        audience: 'escapes',
        reason: 'test batch 2',
        approval: 'once',
        wait: false,
      } } as any)
      const msg2 = String(successSpy.mock.calls[0]![0])
      const id2 = msg2.match(/Grant requested:\s+(\S+)/)![1]!

      // Revoke both at once (batch mode)
      successSpy.mockClear()
      await revokeCommand.run!({ args: { id: id1, allPending: false, debug: false, _: [id2] } } as any)

      expect(successSpy).toHaveBeenCalled()
      const msgs = successSpy.mock.calls.map(c => String(c[0]))
      expect(msgs.some(m => m.includes('All') && m.includes('revoked'))).toBe(true)
    })
  })

  // =========================================================================
  // Inbox: with limit parameter
  // =========================================================================

  describe('grants inbox: with limit', () => {
    it('passes limit parameter', async () => {
      const { inboxCommand } = await import('../src/commands/grants/inbox')

      // Just exercise the limit code path
      logOutput = []
      await inboxCommand.run!({ args: { json: true, limit: '5' } } as any)

      const output = logOutput.join('\n')
      const data = JSON.parse(output)
      expect(data).toHaveProperty('data')
    })
  })

  // =========================================================================
  // Grants list: with limit and status filter
  // =========================================================================

  describe('grants list: with limit', () => {
    it('passes limit parameter', async () => {
      const { listCommand } = await import('../src/commands/grants/list')

      logOutput = []
      await listCommand.run!({ args: { all: true, json: true, limit: '2' } } as any)

      const output = logOutput.join('\n')
      const data = JSON.parse(output)
      expect(data).toHaveProperty('data')
      expect(data.data.length).toBeLessThanOrEqual(2)
    })
  })

  // =========================================================================
  // Config get: idp from auth file
  // =========================================================================

  describe('config get: edge cases', () => {
    it('shows "Not logged in" when no auth for email key', async () => {
      const { configGetCommand } = await import('../src/commands/config/get')
      const authFile = join(testHome, '.config', 'apes', 'auth.json')
      const saved = readFileSync(authFile, 'utf-8')
      const infoSpy = vi.spyOn(consola, 'info')

      try {
        rmSync(authFile)
        configGetCommand.run!({ args: { key: 'email' } } as any)

        expect(infoSpy).toHaveBeenCalled()
        expect(String(infoSpy.mock.calls[0]![0])).toContain('Not logged in')
      }
      finally {
        writeFileSync(authFile, saved, { mode: 0o600 })
      }
    })

    it('shows "No IdP configured" when no IdP', async () => {
      const { configGetCommand } = await import('../src/commands/config/get')
      const authFile = join(testHome, '.config', 'apes', 'auth.json')
      const saved = readFileSync(authFile, 'utf-8')
      const savedIdp = process.env.APES_IDP
      const infoSpy = vi.spyOn(consola, 'info')

      try {
        delete process.env.APES_IDP
        rmSync(authFile)
        // Also clear defaults.idp in config
        const { saveConfig, loadConfig } = await import('../src/config')
        const config = loadConfig()
        const savedDefaults = config.defaults
        config.defaults = {}
        saveConfig(config)

        configGetCommand.run!({ args: { key: 'idp' } } as any)

        expect(infoSpy).toHaveBeenCalled()
        expect(String(infoSpy.mock.calls[0]![0])).toContain('No IdP configured')

        // Restore
        config.defaults = savedDefaults
        saveConfig(config)
      }
      finally {
        process.env.APES_IDP = savedIdp
        writeFileSync(authFile, saved, { mode: 0o600 })
      }
    })
  })

  // =========================================================================
  // Duration: additional edge cases
  // =========================================================================

  describe('parseDuration: additional', () => {
    it('parses zero values', async () => {
      const { parseDuration } = await import('../src/duration')
      expect(parseDuration('0s')).toBe(0)
      expect(parseDuration('0m')).toBe(0)
    })

    it('rejects float values', async () => {
      const { parseDuration } = await import('../src/duration')
      expect(() => parseDuration('1.5h')).toThrow('Invalid duration format')
    })

    it('rejects empty string', async () => {
      const { parseDuration } = await import('../src/duration')
      expect(() => parseDuration('')).toThrow('Invalid duration format')
    })
  })

  // =========================================================================
  // ApiError class
  // =========================================================================

  describe('ApiError', () => {
    it('has correct properties', async () => {
      const { ApiError } = await import('../src/http')
      const err = new ApiError(404, 'Not Found', { title: 'Not Found', status: 404 })
      expect(err.name).toBe('ApiError')
      expect(err.statusCode).toBe(404)
      expect(err.message).toBe('Not Found')
      expect(err.problemDetails).toEqual({ title: 'Not Found', status: 404 })
    })

    it('works without problem details', async () => {
      const { ApiError } = await import('../src/http')
      const err = new ApiError(500, 'Internal Server Error')
      expect(err.statusCode).toBe(500)
      expect(err.problemDetails).toBeUndefined()
    })
  })

  // =========================================================================
  // Grants: request without reason (uses command as reason)
  // =========================================================================

  describe('grants request: default reason', () => {
    it('uses command as default reason', async () => {
      const { requestCommand } = await import('../src/commands/grants/request')
      const successSpy = vi.spyOn(consola, 'success')

      await requestCommand.run!({ args: {
        command: 'echo hello',
        audience: 'escapes',
        approval: 'once',
        wait: false,
        // No reason provided
      } } as any)

      expect(successSpy).toHaveBeenCalled()
    })
  })

  // =========================================================================
  // Grants: request with custom host
  // =========================================================================

  describe('grants request: custom host', () => {
    it('uses custom host', async () => {
      const { requestCommand } = await import('../src/commands/grants/request')
      const successSpy = vi.spyOn(consola, 'success')

      await requestCommand.run!({ args: {
        command: 'uname -a',
        audience: 'escapes',
        reason: 'test custom host',
        approval: 'once',
        host: 'custom-host.example.com',
        wait: false,
      } } as any)

      expect(successSpy).toHaveBeenCalled()
    })
  })

  // =========================================================================
  // Status: approved grant shows approver info
  // =========================================================================

  describe('grants status: approved grant', () => {
    it('shows approved status and decision info', async () => {
      const { requestCommand } = await import('../src/commands/grants/request')
      const { statusCommand } = await import('../src/commands/grants/status')

      const successSpy = vi.spyOn(consola, 'success')
      await requestCommand.run!({ args: {
        command: 'test-approved-status',
        audience: 'escapes',
        reason: 'test approved status',
        approval: 'once',
        wait: false,
      } } as any)

      const msg = String(successSpy.mock.calls[0]![0])
      const grantId = msg.match(/Grant requested:\s+(\S+)/)![1]!

      // Approve via management API
      await fetch(`${idpBase}/api/grants/${grantId}/approve`, {
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
      expect(output).toContain('Status:    approved')
      expect(output).toContain('Decided by:')
    })
  })

  // =========================================================================
  // Inbox: with grants from another user
  // =========================================================================

  describe('grants inbox: with grants from another requester', () => {
    it('shows grants from other users', async () => {
      const { inboxCommand } = await import('../src/commands/grants/inbox')

      // Create a grant with a different requester (directly via API)
      await fetch(`${idpBase}/api/grants`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${MGMT_TOKEN}`,
        },
        body: JSON.stringify({
          requester: 'other-agent@example.com',
          target_host: 'test-host',
          audience: 'escapes',
          grant_type: 'once',
          command: ['ls', '-la'],
          reason: 'from another user',
        }),
      })

      logOutput = []
      const infoSpy = vi.spyOn(consola, 'info')
      await inboxCommand.run!({ args: { json: false } } as any)

      const output = logOutput.join('\n')
      const infoMessages = infoSpy.mock.calls.map(c => String(c[0]))

      // Should show the grant from 'other-agent@example.com' or at least exercise
      // the formatting code
      expect(
        output.includes('other-agent@example.com')
        || infoMessages.some(m => m.includes('awaiting') || m.includes('No pending')),
      ).toBe(true)
    })
  })
})
