import { Buffer } from 'node:buffer'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const testFile = fileURLToPath(import.meta.url)
const appDir = dirname(dirname(testFile))
const monorepoRoot = dirname(dirname(appDir))
const shapesCli = join(monorepoRoot, 'packages', 'shapes', 'dist', 'cli.js')

const MANAGEMENT_TOKEN = 'openape-e2e-management-token'
const SESSION_SECRET = 'openape-e2e-session-secret-1234567890123456'
const APPROVER_EMAIL = 'approver@example.com'
const AGENT_EMAIL = 'agent+e2e@example.com'

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForServer(url: string, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok)
        return
    }
    catch {}
    await wait(250)
  }
  throw new Error(`Timed out waiting for server: ${url}`)
}

async function waitForGrantId(
  baseUrl: string,
  requester: string,
  timeoutMs = 60_000,
  onPoll?: () => void,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    onPoll?.()
    const response = await fetch(`${baseUrl}/api/grants?requester=${encodeURIComponent(requester)}`)
    if (response.ok) {
      const body = await response.json() as { data?: Array<{ id: string }> }
      const grantId = body.data?.[0]?.id
      if (grantId)
        return grantId
    }
    await wait(250)
  }
  throw new Error('Timed out waiting for pending grant')
}

async function waitForProcess(child: ReturnType<typeof spawn>, timeoutMs = 30_000) {
  return await new Promise<{ code: number | null, signal: NodeJS.Signals | null }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error('Process timed out'))
    }, timeoutMs)

    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      resolve({ code, signal })
    })
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
  })
}

function encodeSshString(value: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(value.length, 0)
  return Buffer.concat([length, value])
}

async function publicKeyToSsh(publicKey: CryptoKey): Promise<string> {
  const jwk = await exportJWK(publicKey)
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || !jwk.x) {
    throw new Error('Expected Ed25519 public key')
  }

  const keyType = Buffer.from('ssh-ed25519')
  const keyBytes = Buffer.from(jwk.x, 'base64url')
  const payload = Buffer.concat([encodeSshString(keyType), encodeSshString(keyBytes)])
  return `ssh-ed25519 ${payload.toString('base64')}`
}

async function createAgentToken(baseUrl: string, privateKey: CryptoKey, agentEmail: string): Promise<string> {
  const assertion = await new SignJWT({})
    .setProtectedHeader({ alg: 'EdDSA' })
    .setIssuer(agentEmail)
    .setSubject(agentEmail)
    .setAudience(`${baseUrl}/token`)
    .setExpirationTime('60s')
    .setJti(crypto.randomUUID())
    .setIssuedAt()
    .sign(privateKey)

  const response = await fetch(`${baseUrl}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: assertion,
    }),
  })
  if (!response.ok) {
    throw new Error(`Agent token request failed: ${response.status} ${await response.text()}`)
  }

  const body = await response.json() as { access_token: string }
  return body.access_token
}

describe('free-idp + shapes end-to-end', () => {
  let sandboxDir = ''
  let server: ReturnType<typeof spawn> | null = null

  beforeEach(() => {
    sandboxDir = mkdtempSync(join(tmpdir(), 'openape-shapes-e2e-'))
  })

  afterEach(() => {
    if (server) {
      server.kill('SIGTERM')
      server = null
    }
    if (sandboxDir) {
      rmSync(sandboxDir, { recursive: true, force: true })
    }
  })

  it('runs shapes request through grant creation, approval, token fetch, consume, and wrapped CLI execution', async () => {
    const port = 3311 + Math.floor(Math.random() * 200)
    const baseUrl = `http://127.0.0.1:${port}`

    const build = spawnSync('pnpm', ['--filter', '@openape/shapes', 'build'], {
      cwd: monorepoRoot,
      encoding: 'utf-8',
    })
    expect(build.status).toBe(0)

    server = spawn('pnpm', ['exec', 'nuxt', 'dev', '--port', String(port), '--host', '127.0.0.1'], {
      cwd: appDir,
      env: {
        ...process.env,
        OPENAPE_E2E: '1',
        OPENAPE_ISSUER: baseUrl,
        OPENAPE_RP_ORIGIN: baseUrl,
        OPENAPE_RP_ID: '127.0.0.1',
        OPENAPE_SESSION_SECRET: SESSION_SECRET,
        OPENAPE_MANAGEMENT_TOKEN: MANAGEMENT_TOKEN,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let serverLogs = ''
    server.stdout?.on('data', (chunk) => { serverLogs += chunk.toString() })
    server.stderr?.on('data', (chunk) => { serverLogs += chunk.toString() })

    await waitForServer(`${baseUrl}/.well-known/openid-configuration`)

    const { publicKey, privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' })
    const sshPublicKey = await publicKeyToSsh(publicKey)

    const createAgentResponse = await fetch(`${baseUrl}/api/admin/agents`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MANAGEMENT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: AGENT_EMAIL,
        name: 'E2E Agent',
        owner: APPROVER_EMAIL,
        approver: APPROVER_EMAIL,
        publicKey: sshPublicKey,
      }),
    })
    expect(createAgentResponse.status).toBe(200)

    const agentToken = await createAgentToken(baseUrl, privateKey, AGENT_EMAIL)

    const apesConfigDir = join(sandboxDir, '.config', 'apes')
    mkdirSync(apesConfigDir, { recursive: true })
    writeFileSync(join(apesConfigDir, 'auth.json'), JSON.stringify({
      idp: baseUrl,
      access_token: agentToken,
      email: AGENT_EMAIL,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    }))

    const binDir = join(sandboxDir, 'bin')
    mkdirSync(binDir, { recursive: true })
    const executionLog = join(sandboxDir, 'exo-exec.txt')
    const exoScript = join(binDir, 'exo')
    writeFileSync(exoScript, `#!/bin/sh\nprintf '%s\\n' \"$@\" > \"${executionLog}\"\n`)
    spawnSync('chmod', ['+x', exoScript], { encoding: 'utf-8' })

    const shapes = spawn('node', [shapesCli, 'request', '--idp', baseUrl, '--approval', 'once', '--', 'exo', 'dns', 'show', 'example.com'], {
      cwd: monorepoRoot,
      env: {
        ...process.env,
        HOME: sandboxDir,
        PATH: `${binDir}:${process.env.PATH}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let shapesStdout = ''
    let shapesStderr = ''
    shapes.stdout?.on('data', (chunk) => { shapesStdout += chunk.toString() })
    shapes.stderr?.on('data', (chunk) => { shapesStderr += chunk.toString() })

    let shapesExited = false
    let shapesExitCode: number | null = null
    shapes.once('exit', (code) => {
      shapesExited = true
      shapesExitCode = code
    })

    const grantId = await waitForGrantId(baseUrl, AGENT_EMAIL, 60_000, () => {
      if (shapesExited) {
        throw new Error([
          `shapes exited before creating a grant (code: ${shapesExitCode})`,
          `stdout:\n${shapesStdout}`,
          `stderr:\n${shapesStderr}`,
          `server:\n${serverLogs}`,
        ].join('\n\n'))
      }
    })

    const sessionResponse = await fetch(`${baseUrl}/api/test/session`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${MANAGEMENT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: APPROVER_EMAIL }),
    })
    expect(sessionResponse.status).toBe(200)
    const sessionCookie = sessionResponse.headers.get('set-cookie')
    expect(sessionCookie).toBeTruthy()

    const approveResponse = await fetch(`${baseUrl}/api/grants/${grantId}/approve`, {
      method: 'POST',
      headers: {
        Cookie: sessionCookie!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ grant_type: 'once' }),
    })
    expect(approveResponse.status).toBe(200)

    const result = await waitForProcess(shapes, 30_000)
    expect(result.code).toBe(0)
    expect(readFileSync(executionLog, 'utf-8')).toBe('dns\nshow\nexample.com\n')

    const grantResponse = await fetch(`${baseUrl}/api/grants/${grantId}`)
    const grant = await grantResponse.json() as { status: string, used_at?: number }
    expect(grant.status).toBe('used')
    expect(grant.used_at).toBeTypeOf('number')

    if (serverLogs.includes('ERROR')) {
      expect(serverLogs).not.toContain(' ERROR ')
    }
  }, 90_000)
})
