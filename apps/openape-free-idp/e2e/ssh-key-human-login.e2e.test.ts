import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { generateKeyPairSync, sign } from 'node:crypto'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const appDir = dirname(dirname(fileURLToPath(import.meta.url)))

const MANAGEMENT_TOKEN = 'openape-ssh-key-test-management-token'
const SESSION_SECRET = 'openape-ssh-key-test-session-secret-123456'
const USER_EMAIL = 'ssh-key-test@example.com'
const USER_NAME = 'SSH Key Test User'

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForServer(url: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    }
    catch {}
    await wait(250)
  }
  throw new Error(`Timed out waiting for server: ${url}`)
}

function sshEd25519Line(rawPublicKey: Buffer, comment: string): string {
  const keyType = Buffer.from('ssh-ed25519')
  const lenBuf = (n: number) => {
    const b = Buffer.alloc(4); b.writeUInt32BE(n, 0); return b
  }
  const wire = Buffer.concat([lenBuf(keyType.length), keyType, lenBuf(rawPublicKey.length), rawPublicKey])
  return `ssh-ed25519 ${wire.toString('base64')} ${comment}`
}

describe('SSH-key login for humans', () => {
  const port = 3401 + Math.floor(Math.random() * 200)
  const baseUrl = `http://127.0.0.1:${port}`
  let server: ReturnType<typeof spawn> | null = null
  let serverLogs = ''

  beforeAll(async () => {
    server = spawn('pnpm', ['exec', 'nuxt', 'dev', '--port', String(port), '--host', '127.0.0.1'], {
      cwd: appDir,
      detached: true,
      env: {
        ...process.env,
        OPENAPE_E2E: '1',
        OPENAPE_ISSUER: baseUrl,
        OPENAPE_RP_ORIGIN: baseUrl,
        OPENAPE_RP_ID: '127.0.0.1',
        OPENAPE_RP_HOST_ALLOWLIST: '127.0.0.1',
        OPENAPE_SESSION_SECRET: SESSION_SECRET,
        OPENAPE_MANAGEMENT_TOKEN: MANAGEMENT_TOKEN,
        OPENAPE_ADMIN_EMAILS: USER_EMAIL,
        NUXT_TURSO_URL: 'file::memory:',
        NUXT_TURSO_AUTH_TOKEN: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    server.stdout?.on('data', (chunk) => { serverLogs += chunk.toString() })
    server.stderr?.on('data', (chunk) => { serverLogs += chunk.toString() })

    try {
      await waitForServer(`${baseUrl}/.well-known/openid-configuration`, 60_000)
    }
    catch (err) {
      console.error('Server failed to start. Last logs:\n', serverLogs.slice(-4000))
      throw err
    }
  }, 90_000)

  afterAll(async () => {
    if (server?.pid) {
      // Kill the process group so the nuxt child dies with the pnpm wrapper
      try { process.kill(-server.pid, 'SIGKILL') }
      catch { /* already gone */ }
    }
    server = null
    await wait(200)
  })

  it('issues a JWT with act:"human" after a successful SSH-key challenge/response', async () => {
    // Generate an ed25519 keypair.
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const spki = publicKey.export({ format: 'der', type: 'spki' })
    const rawPub = spki.subarray(spki.length - 32)
    const sshPubKey = sshEd25519Line(rawPub, USER_EMAIL)

    // Create the user.
    const createUserRes = await fetch(`${baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MANAGEMENT_TOKEN}` },
      body: JSON.stringify({ email: USER_EMAIL, name: USER_NAME }),
    })
    expect([200, 201, 409]).toContain(createUserRes.status)

    // Register the SSH public key.
    const regKeyRes = await fetch(
      `${baseUrl}/api/admin/users/${encodeURIComponent(USER_EMAIL)}/ssh-keys`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MANAGEMENT_TOKEN}` },
        body: JSON.stringify({ publicKey: sshPubKey, name: 'test-key' }),
      },
    )
    expect([200, 201]).toContain(regKeyRes.status)

    // Request a challenge.
    const chRes = await fetch(`${baseUrl}/api/auth/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: USER_EMAIL }),
    })
    expect(chRes.status).toBe(200)
    const { challenge } = await chRes.json() as { challenge: string }
    expect(challenge).toMatch(/^[a-f0-9]{32,}$/)

    // Sign the challenge bytes with the Ed25519 private key.
    const signature = sign(null, Buffer.from(challenge), privateKey).toString('base64')

    // Authenticate.
    const authRes = await fetch(`${baseUrl}/api/auth/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: USER_EMAIL, challenge, signature, public_key: sshPubKey }),
    })
    expect(authRes.status).toBe(200)

    const authBody = await authRes.json() as {
      token: string
      id: string
      email: string
      name: string
      act: 'human' | 'agent'
      expires_in: number
    }
    expect(authBody.act).toBe('human')
    expect(authBody.sub ?? authBody.id).toBe(USER_EMAIL)
    expect(authBody.email).toBe(USER_EMAIL)
    expect(authBody.token.split('.').length).toBe(3)

    // Decode JWT claims (signature already checked implicitly by the endpoint roundtrip).
    const [, payloadB64] = authBody.token.split('.')
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as {
      sub: string; act: string; iss: string; iat: number; exp: number
    }
    expect(payload.sub).toBe(USER_EMAIL)
    expect(payload.act).toBe('human')
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
    expect(payload.iss).toContain('127.0.0.1')
  }, 90_000)

  it('rejects a forged signature', async () => {
    const chRes = await fetch(`${baseUrl}/api/auth/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: USER_EMAIL }),
    })
    expect(chRes.status).toBe(200)
    const { challenge } = await chRes.json() as { challenge: string }

    // Sign with a FRESH key (not the one registered for this user).
    const { privateKey: forged } = generateKeyPairSync('ed25519')
    const signature = sign(null, Buffer.from(challenge), forged).toString('base64')

    const authRes = await fetch(`${baseUrl}/api/auth/authenticate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: USER_EMAIL, challenge, signature }),
    })
    expect(authRes.status).toBe(401)
  }, 30_000)
})
