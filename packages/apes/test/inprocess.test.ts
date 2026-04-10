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
// Isolate HOME to a tmpdir so config.ts reads/writes there
// ---------------------------------------------------------------------------

const testHome = join(tmpdir(), `apes-inprocess-${process.pid}-${Date.now()}`)
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
// Test suite
// ---------------------------------------------------------------------------

describe('apes CLI in-process tests', () => {
  let server: Server
  let port: number
  let idpBase: string
  const MGMT_TOKEN = 'test-mgmt-token-123'
  const AGENT_EMAIL = 'agent+test@example.com'
  const OWNER_EMAIL = 'admin@example.com'
  const keyPair = generateTestKeyPair()

  // Capture console output
  let logOutput: string[]
  let stdoutOutput: string[]

  beforeAll(async () => {
    // Write the test private key
    writeFileSync(join(testHome, 'test_key'), keyPair.privateKeyPem, { mode: 0o600 })

    // Set APES_IDP so commands discover it
    process.env.APES_IDP = '' // Will be set after server starts

    // ---- start IdP ----
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

    // ---- compat routes for agent_id -> id field mapping ----
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
            key: {
              kty: 'OKP',
              crv: 'Ed25519',
              x: rawKey.toString('base64url'),
            },
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

    // ---- enroll agent user with SSH key ----
    const enrollRes = await fetch(`${idpBase}/api/auth/enroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MGMT_TOKEN}`,
      },
      body: JSON.stringify({
        email: AGENT_EMAIL,
        name: 'Test Agent',
        publicKey: keyPair.publicKeySsh,
        owner: OWNER_EMAIL,
      }),
    })
    if (!enrollRes.ok) {
      throw new Error(`Enroll failed: ${enrollRes.status} ${await enrollRes.text()}`)
    }
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

  // ---------- 1. Login with SSH key ----------
  it('login: authenticates with SSH key challenge-response', async () => {
    const { loginCommand } = await import('../src/commands/auth/login')
    expect(existsSync(join(testHome, 'test_key'))).toBe(true)

    await loginCommand.run!({ args: {
      idp: idpBase,
      key: join(testHome, 'test_key'),
      email: AGENT_EMAIL,
    } } as any)

    // Verify auth.json was written with correct data
    const authFile = join(testHome, '.config', 'apes', 'auth.json')
    expect(existsSync(authFile)).toBe(true)

    const auth = JSON.parse(readFileSync(authFile, 'utf-8'))
    expect(auth.email).toBe(AGENT_EMAIL)
    expect(auth.idp).toBe(idpBase)
    expect(auth.access_token).toBeTruthy()
    expect(auth.expires_at).toBeGreaterThan(Date.now() / 1000)
  })

  // ---------- 1b. Login persists agent key path to config.toml ----------
  it('login: persists absolute key path and email to config.toml for auto-refresh', async () => {
    const { loginCommand } = await import('../src/commands/auth/login')

    const configFile = join(testHome, '.config', 'apes', 'config.toml')
    // Pre-seed an existing [defaults] section so we verify the merge.
    // Use `approval` (not `idp`) to avoid poisoning later "no IdP configured" tests.
    writeFileSync(configFile, '[defaults]\napproval = "once"\n', { mode: 0o600 })

    await loginCommand.run!({ args: {
      idp: idpBase,
      key: join(testHome, 'test_key'),
      email: AGENT_EMAIL,
    } } as any)

    expect(existsSync(configFile)).toBe(true)
    const tomlContent = readFileSync(configFile, 'utf-8')

    // [agent] section must exist with an ABSOLUTE key path + the email
    expect(tomlContent).toContain('[agent]')
    const expectedKeyPath = join(testHome, 'test_key')
    expect(tomlContent).toContain(`key = "${expectedKeyPath}"`)
    expect(tomlContent).toContain(`email = "${AGENT_EMAIL}"`)

    // Existing [defaults] must be preserved (merge, not replace)
    expect(tomlContent).toContain('[defaults]')
    expect(tomlContent).toContain('approval = "once"')

    // And the loaded config should reflect both
    const { loadConfig } = await import('../src/config')
    const loaded = loadConfig()
    expect(loaded.agent?.key).toBe(expectedKeyPath)
    expect(loaded.agent?.email).toBe(AGENT_EMAIL)
    expect(loaded.defaults?.approval).toBe('once')
  })

  // ---------- 2. Whoami ----------
  it('whoami: shows current identity after login', async () => {
    const { whoamiCommand } = await import('../src/commands/auth/whoami')

    whoamiCommand.run!({ args: {} } as any)

    const output = logOutput.join('\n')
    expect(output).toContain(`Email: ${AGENT_EMAIL}`)
    expect(output).toContain('Type:  agent')
    expect(output).toContain(`IdP:   ${idpBase}`)
    expect(output).toContain('valid')
  })

  // ---------- 3. Grants list (empty) ----------
  it('grants list: returns empty list when no grants exist', async () => {
    const { listCommand } = await import('../src/commands/grants/list')

    const infoSpy = vi.spyOn(consola, 'info')

    await listCommand.run!({ args: { all: false, json: false } } as any)

    // consola.info is called with "No grants found" message
    expect(infoSpy).toHaveBeenCalled()
    const infoMsg = infoSpy.mock.calls[0]![0] as string
    expect(infoMsg).toContain('No grants found')
  })

  // ---------- 4. Grant lifecycle ----------
  it('grants: full lifecycle -- request, approve, get token', async () => {
    const { requestCommand } = await import('../src/commands/grants/request')
    const { tokenCommand } = await import('../src/commands/grants/token')
    const { listCommand } = await import('../src/commands/grants/list')

    // 4a: Request a grant
    const successSpy = vi.spyOn(consola, 'success')

    await requestCommand.run!({ args: {
      command: 'ls -la',
      audience: 'escapes',
      reason: 'integration test',
      approval: 'once',
      wait: false,
    } } as any)

    // Extract grant ID from consola.success call
    expect(successSpy).toHaveBeenCalled()
    const successMsg = successSpy.mock.calls[0]![0] as string
    const idMatch = successMsg.match(/Grant requested:\s+(\S+)/)
    expect(idMatch).toBeTruthy()
    const grantId = idMatch![1]!

    // 4b: Approve the grant via management token
    const approveRes = await fetch(`${idpBase}/api/grants/${grantId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MGMT_TOKEN}`,
      },
      body: JSON.stringify({}),
    })
    expect(approveRes.ok).toBe(true)
    const approveData = await approveRes.json() as { grant: { status: string } }
    expect(approveData.grant.status).toBe('approved')

    // 4c: Get grant token via command
    successSpy.mockClear()
    stdoutOutput = []

    await tokenCommand.run!({ args: { id: grantId } } as any)

    const tokenOutput = stdoutOutput.join('')
    expect(tokenOutput).toBeTruthy()
    // JWT has 3 parts separated by dots
    const jwtParts = tokenOutput.trim().split('.')
    expect(jwtParts.length).toBe(3)

    // 4d: Verify the JWT payload contains the grant
    const payload = JSON.parse(Buffer.from(jwtParts[1]!, 'base64url').toString())
    expect(payload.grant_id).toBe(grantId)

    // 4e: Verify grants list now shows the grant
    logOutput = []

    await listCommand.run!({ args: { all: true, json: true } } as any)

    const listOutput = logOutput.join('\n')
    const listData = JSON.parse(listOutput)
    expect(listData.data.length).toBeGreaterThanOrEqual(1)
    const ourGrant = listData.data.find((g: { id: string }) => g.id === grantId)
    expect(ourGrant).toBeTruthy()
    expect(ourGrant.status).toBe('approved')
  })

  // ---------- 5. Workflows ----------
  it('workflows: lists available workflow guides', async () => {
    const { workflowsCommand } = await import('../src/commands/workflows')

    workflowsCommand.run!({ args: { json: false } } as any)

    const output = logOutput.join('\n')
    expect(output).toContain('Workflow Guides')
    expect(output).toContain('timed-session')
  })

  it('workflows: shows a specific guide', async () => {
    const { workflowsCommand } = await import('../src/commands/workflows')

    workflowsCommand.run!({ args: { id: 'timed-session', json: false } } as any)

    const output = logOutput.join('\n')
    expect(output).toContain('Timed maintenance session')
  })

  // ---------- 6. Error cases ----------
  it('whoami: throws CliError when not logged in', async () => {
    const { CliError } = await import('../src/errors')

    // Clear auth file to simulate not logged in
    const authFile = join(testHome, '.config', 'apes', 'auth.json')
    const savedAuth = existsSync(authFile) ? readFileSync(authFile, 'utf-8') : null

    try {
      // Remove auth file
      if (existsSync(authFile)) rmSync(authFile)

      const { whoamiCommand } = await import('../src/commands/auth/whoami')

      expect(() => whoamiCommand.run!({ args: {} } as any)).toThrow(CliError)
    }
    finally {
      // Restore auth file
      if (savedAuth) {
        mkdirSync(join(testHome, '.config', 'apes'), { recursive: true })
        writeFileSync(authFile, savedAuth, { mode: 0o600 })
      }
    }
  })

  it('login: throws CliError when no IdP specified', async () => {
    const { CliError } = await import('../src/errors')
    const { loginCommand } = await import('../src/commands/auth/login')

    // Temporarily remove APES_IDP
    const savedIdp = process.env.APES_IDP
    delete process.env.APES_IDP

    try {
      await expect(
        loginCommand.run!({ args: {} } as any),
      ).rejects.toThrow(CliError)
    }
    finally {
      process.env.APES_IDP = savedIdp
    }
  })

  it('workflows: throws CliError for unknown guide', async () => {
    const { CliError } = await import('../src/errors')
    const { workflowsCommand } = await import('../src/commands/workflows')

    expect(() =>
      workflowsCommand.run!({ args: { id: 'nonexistent', json: false } } as any),
    ).toThrow(CliError)
  })

  // NOTE: This test MUST remain the last test in this describe block because
  // it wipes the auth.json and [agent] section, leaving no valid login state.
  it('logout: wipes [agent] section from config.toml but keeps [defaults]', async () => {
    const { logoutCommand } = await import('../src/commands/auth/logout')

    const configFile = join(testHome, '.config', 'apes', 'config.toml')
    // Sanity: after earlier tests, [agent] section should already be present.
    const beforeLogout = readFileSync(configFile, 'utf-8')
    expect(beforeLogout).toContain('[agent]')

    logoutCommand.run!({ args: {} } as any)

    const afterLogout = readFileSync(configFile, 'utf-8')
    expect(afterLogout).not.toContain('[agent]')
    expect(afterLogout).not.toMatch(/^key = /m)
    // [defaults] that was pre-seeded in test 1b must survive.
    expect(afterLogout).toContain('[defaults]')
  })
})
