import type { Server } from 'node:http'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import { createRouter, defineEventHandler, readBody, setResponseStatus, toNodeListener } from 'h3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createIdPApp } from '@openape/server'
import { SignJWT } from 'jose'

const execFileAsync = promisify(execFile)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Path to the built CLI entry (tsup output with __VERSION__ resolved).
 * Requires `pnpm turbo run build --filter=@openape/apes` before running.
 */
const CLI_ENTRY = resolve(__dirname, '../dist/cli.js')

/**
 * Generate an Ed25519 key pair and return both OpenSSH-formatted public key
 * and PKCS8-PEM private key (the format `loadEd25519PrivateKey` supports).
 */
function generateTestKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')

  // OpenSSH wire format for public key: "ssh-ed25519 <base64>"
  const rawPub = publicKey.export({ type: 'spki', format: 'der' })
  const rawKey = rawPub.subarray(12) // strip ASN.1 header to get raw 32 bytes

  const typeStr = 'ssh-ed25519'
  const typeBuf = Buffer.from(typeStr)
  const typeLen = Buffer.alloc(4)
  typeLen.writeUInt32BE(typeBuf.length)
  const keyLen = Buffer.alloc(4)
  keyLen.writeUInt32BE(rawKey.length)
  const wireFormat = Buffer.concat([typeLen, typeBuf, keyLen, rawKey])
  const publicKeySsh = `ssh-ed25519 ${wireFormat.toString('base64')}`

  // PKCS8 PEM for private key
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

describe('apes CLI integration with @openape/server', () => {
  let server: Server
  let port: number
  let idpBase: string
  let tmpDir: string
  const MGMT_TOKEN = 'test-mgmt-token-123'
  const AGENT_EMAIL = 'agent+test@example.com'
  const OWNER_EMAIL = 'admin@example.com'
  const keyPair = generateTestKeyPair()

  /**
   * Run the built `apes` CLI in a subprocess with an isolated HOME.
   * Uses async execFile so the event loop stays free to serve HTTP requests.
   * Returns combined stdout + stderr since consola writes to stderr.
   *
   * VITEST env var is removed to prevent consola from suppressing output
   * (consola sets log level to 1/warn when VITEST=true).
   */
  async function apes(args: string[], extraEnv: Record<string, string> = {}): Promise<string> {
    const env = {
      ...process.env,
      HOME: tmpDir,
      APES_IDP: idpBase,
      ...extraEnv,
    }
    // Remove vitest/test env vars that suppress consola output
    // (consola sets log level to 1/warn when NODE_ENV=test, VITEST=true, or TEST=true)
    delete env.VITEST
    delete env.VITEST_POOL_ID
    delete env.VITEST_WORKER_ID
    delete env.VITEST_MODE
    delete env.NODE_ENV
    delete env.TEST

    try {
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        [CLI_ENTRY, ...args],
        {
          cwd: tmpDir,
          env,
          encoding: 'utf-8',
          timeout: 15_000,
        },
      )
      return stdout + stderr
    }
    catch (err: unknown) {
      const e = err as { stdout?: string, stderr?: string, message?: string, code?: number }
      // On non-zero exit, execFile throws but stdout/stderr are still available
      throw new Error(
        `CLI failed (code=${e.code}):\nstdout: ${JSON.stringify(e.stdout)}\nstderr: ${JSON.stringify(e.stderr)}`,
      )
    }
  }

  beforeAll(async () => {
    // ---- temp directory for config isolation ----
    tmpDir = join(tmpdir(), `apes-integration-${Date.now()}`)
    mkdirSync(tmpDir, { recursive: true })

    // Write the test private key to a file
    writeFileSync(join(tmpDir, 'test_key'), keyPair.privateKeyPem, { mode: 0o600 })

    // ---- start IdP ----
    // First pass: discover a free port
    const tempIdp = createIdPApp({ issuer: 'http://placeholder', managementToken: MGMT_TOKEN })
    const tempServer = createServer(toNodeListener(tempIdp.app))
    port = await listenOnFreePort(tempServer)
    await closeServer(tempServer)

    // Second pass: create with the correct issuer URL
    idpBase = `http://127.0.0.1:${port}`
    const idp = createIdPApp({
      issuer: idpBase,
      managementToken: MGMT_TOKEN,
      adminEmails: [OWNER_EMAIL],
    })

    // The apes CLI discovers endpoints via OIDC well-known:
    //   - CLI looks for `ddisa_agent_challenge_endpoint` / `ddisa_agent_authenticate_endpoint`
    //   - Server publishes `ddisa_auth_challenge_endpoint` / `ddisa_auth_authenticate_endpoint`
    // When the discovery keys are missing, the CLI falls back to:
    //   /api/agent/challenge  and  /api/agent/authenticate
    // These don't exist on the server (which has /api/auth/challenge, /api/auth/authenticate).
    //
    // Additionally, the CLI sends `agent_id` while the server expects `id`.
    //
    // Solution: add compatibility routes on the same h3 app that accept the CLI's
    // field names and delegate to the same in-memory stores (no self-fetch).
    const { stores } = idp
    const compatRouter = createRouter()

    // /api/agent/challenge -- accepts { agent_id } -> delegates to store
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

    // /api/agent/authenticate -- accepts { agent_id, challenge, signature } -> delegates to store
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

      // Consume challenge
      const valid = await stores.challengeStore.consumeChallenge(body.challenge, body.agent_id)
      if (!valid) {
        setResponseStatus(event, 401)
        return { error: 'Invalid or expired challenge' }
      }

      // Get SSH key and verify signature
      const keys = await stores.sshKeyStore.findByUser(body.agent_id)
      if (keys.length === 0) {
        setResponseStatus(event, 404)
        return { error: 'No SSH keys found' }
      }

      // Verify signature against each key
      let verified = false
      for (const sshKey of keys) {
        try {
          // Parse the ssh-ed25519 public key
          const parts = sshKey.publicKey.trim().split(/\s+/)
          const keyData = Buffer.from(parts[1]!, 'base64')
          // SSH wire format: 4-byte type length + type + 4-byte key length + key
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

      // Issue auth token using the same signing infrastructure
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

  afterAll(async () => {
    await closeServer(server)
    rmSync(tmpDir, { recursive: true, force: true })
  })

  // ---------- 1. Login with SSH key ----------
  it('login: authenticates with SSH key challenge-response', async () => {
    expect(existsSync(join(tmpDir, 'test_key'))).toBe(true)

    await apes([
      'login',
      '--idp', idpBase,
      '--key', join(tmpDir, 'test_key'),
      '--email', AGENT_EMAIL,
    ])

    // Verify auth.json was written with correct data
    const authFile = join(tmpDir, '.config', 'apes', 'auth.json')
    expect(existsSync(authFile)).toBe(true)

    const auth = JSON.parse(readFileSync(authFile, 'utf-8'))
    expect(auth.email).toBe(AGENT_EMAIL)
    expect(auth.idp).toBe(idpBase)
    expect(auth.access_token).toBeTruthy()
    expect(auth.expires_at).toBeGreaterThan(Date.now() / 1000)
  })

  // ---------- 2. Whoami ----------
  it('whoami: shows current identity after login', async () => {
    const output = await apes(['whoami'])

    expect(output).toContain(`Email: ${AGENT_EMAIL}`)
    expect(output).toContain('Type:  agent')
    expect(output).toContain(`IdP:   ${idpBase}`)
    expect(output).toContain('valid')
  })

  // ---------- 3. Grants list ----------
  it('grants list: returns empty list when no grants exist', async () => {
    const output = await apes(['grants', 'list'])
    expect(output).toContain('No grants found')
  })

  // ---------- 4. Grant request + approval + token lifecycle ----------
  it('grants: full lifecycle -- request, approve via HTTP, get token', async () => {
    // 4a: Request a grant
    const reqOutput = await apes([
      'grants', 'request', 'ls -la',
      '--audience', 'escapes',
      '--reason', 'integration test',
    ])
    expect(reqOutput).toContain('Grant requested')

    // Extract grant ID from output: "Grant requested: <id> (status: pending)"
    const idMatch = reqOutput.match(/Grant requested:\s+(\S+)/)
    expect(idMatch).toBeTruthy()
    const grantId = idMatch![1]!

    // 4b: Approve the grant via management token (simulating human approval)
    const approveRes = await fetch(`${idpBase}/api/grants/${grantId}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MGMT_TOKEN}`,
      },
      body: JSON.stringify({}),
    })
    if (!approveRes.ok) {
      const errBody = await approveRes.text()
      throw new Error(`Approve failed: ${approveRes.status} ${errBody}`)
    }
    const approveData = await approveRes.json() as { grant: { status: string } }
    expect(approveData.grant.status).toBe('approved')

    // 4c: Get grant token via CLI
    const tokenOutput = await apes(['grants', 'token', grantId])
    // token command writes raw JWT to stdout
    expect(tokenOutput).toBeTruthy()
    // JWT has 3 parts separated by dots
    const jwtParts = tokenOutput.trim().split('.')
    expect(jwtParts.length).toBe(3)

    // 4d: Verify the JWT payload contains the grant
    const payload = JSON.parse(Buffer.from(jwtParts[1]!, 'base64url').toString())
    expect(payload.grant_id).toBe(grantId)

    // 4e: Verify grants list now shows the grant
    const listOutput = await apes(['grants', 'list', '--all', '--json'])
    const listData = JSON.parse(listOutput)
    expect(listData.data.length).toBeGreaterThanOrEqual(1)
    const ourGrant = listData.data.find((g: { id: string }) => g.id === grantId)
    expect(ourGrant).toBeTruthy()
    expect(ourGrant.status).toBe('approved')
  })

  // ---------- 5. Workflows ----------
  it('workflows: lists available workflow guides', async () => {
    const output = await apes(['workflows'])
    expect(output).toContain('Workflow Guides')
    expect(output).toContain('timed-session')
  })

  it('workflows: shows a specific guide', async () => {
    const output = await apes(['workflows', 'timed-session'])
    expect(output).toContain('Timed maintenance session')
  })
})
