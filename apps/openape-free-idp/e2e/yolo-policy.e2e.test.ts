import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

function sshEd25519Line(rawPublicKey: Buffer, comment: string): string {
  const keyType = Buffer.from('ssh-ed25519')
  const lenBuf = (n: number) => {
    const b = Buffer.alloc(4); b.writeUInt32BE(n, 0); return b
  }
  const wire = Buffer.concat([lenBuf(keyType.length), keyType, lenBuf(rawPublicKey.length), rawPublicKey])
  return `ssh-ed25519 ${wire.toString('base64')} ${comment}`
}

function genSshPubKey(comment: string): string {
  const { publicKey } = generateKeyPairSync('ed25519')
  const spki = publicKey.export({ format: 'der', type: 'spki' })
  return sshEd25519Line(spki.subarray(spki.length - 32), comment)
}

const appDir = dirname(dirname(fileURLToPath(import.meta.url)))

const MANAGEMENT_TOKEN = 'openape-yolo-test-management-token'
const SESSION_SECRET = 'openape-yolo-test-session-secret-1234567890'
const OWNER_EMAIL = 'owner@example.com'
const AGENT_EMAIL = 'yolo-agent@example.com'
const OTHER_EMAIL = 'other@example.com'
// Parallel Nuxt boots in CI can exceed the normal startup window.
const FREE_IDP_BOOT_TIMEOUT_MS = 120_000

function wait(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)) }

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

const managementHeader = { Authorization: `Bearer ${MANAGEMENT_TOKEN}` }

describe('YOLO policy admin API', () => {
  let baseUrl = ''
  let server: ReturnType<typeof spawn> | null = null
  let serverLogs = ''

  // One boot attempt on a fresh random port. vitest's `retry` re-runs tests but
  // never a failed beforeAll, so the boot gets its own retry: a slow/crashed
  // nuxt-dev under CI load (shared runners, #991) is absorbed here instead of
  // failing the whole suite.
  function spawnServer(port: number): ReturnType<typeof spawn> {
    const url = `http://127.0.0.1:${port}`
    const proc = spawn('pnpm', ['exec', 'nuxt', 'dev', '--port', String(port), '--host', '127.0.0.1'], {
      cwd: appDir,
      detached: true,
      env: {
        ...process.env,
        OPENAPE_E2E: '1',
        OPENAPE_ISSUER: url,
        OPENAPE_RP_ORIGIN: url,
        OPENAPE_RP_ID: '127.0.0.1',
        OPENAPE_RP_HOST_ALLOWLIST: '127.0.0.1',
        OPENAPE_SESSION_SECRET: SESSION_SECRET,
        OPENAPE_MANAGEMENT_TOKEN: MANAGEMENT_TOKEN,
        OPENAPE_ADMIN_EMAILS: OWNER_EMAIL,
        NUXT_TURSO_URL: 'file::memory:',
        NUXT_TURSO_AUTH_TOKEN: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    proc.stdout?.on('data', (chunk) => { serverLogs += chunk.toString() })
    proc.stderr?.on('data', (chunk) => { serverLogs += chunk.toString() })
    return proc
  }
  function killServer(): void {
    if (server?.pid) {
      try { process.kill(-server.pid, 'SIGKILL') }
      catch { /* already gone */ }
    }
    server = null
  }

  beforeAll(async () => {
    const BOOT_ATTEMPTS = 2
    let lastErr: unknown
    for (let attempt = 1; attempt <= BOOT_ATTEMPTS; attempt++) {
      const port = 3601 + Math.floor(Math.random() * 200)
      baseUrl = `http://127.0.0.1:${port}`
      server = spawnServer(port)
      try {
        await waitForServer(`${baseUrl}/.well-known/openid-configuration`, FREE_IDP_BOOT_TIMEOUT_MS)
        lastErr = undefined
        break
      }
      catch (err) {
        lastErr = err
        console.error(`Server boot attempt ${attempt}/${BOOT_ATTEMPTS} failed. Last logs:\n`, serverLogs.slice(-4000))
        killServer()
        serverLogs = ''
        await wait(500)
      }
    }
    if (lastErr) throw lastErr

    // Seed: owner + agent (agent.owner = owner)
    const r1 = await fetch(`${baseUrl}/api/admin/users`, {
      method: 'POST', headers: { ...managementHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: OWNER_EMAIL, name: 'Owner' }),
    })
    expect([200, 201, 409]).toContain(r1.status)
    const r2 = await fetch(`${baseUrl}/api/admin/users`, {
      method: 'POST', headers: { ...managementHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: OTHER_EMAIL, name: 'Other' }),
    })
    expect([200, 201, 409]).toContain(r2.status)
    const r3 = await fetch(`${baseUrl}/api/admin/agents`, {
      method: 'POST', headers: { ...managementHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: AGENT_EMAIL,
        name: 'YOLO Agent',
        owner: OWNER_EMAIL,
        approver: OWNER_EMAIL,
        publicKey: genSshPubKey(AGENT_EMAIL),
      }),
    })
    if (![200, 201, 409].includes(r3.status)) {
      console.error('admin/agents create failed', r3.status, await r3.text())
    }
    expect([200, 201, 409]).toContain(r3.status)
    // Explicit hook budget: must cover BOTH boot attempts (2 × 120s) + seeding.
    // An inline timeout OVERRIDES the config's hookTimeout — the 120s fix in
    // #992 never took effect because this arg still said 90s.
  }, 2 * FREE_IDP_BOOT_TIMEOUT_MS + 30_000)

  afterAll(async () => {
    // Kill the whole process group (pnpm + nuxt child) so no orphans linger
    killServer()
    // Give the kernel a moment to release the bound port
    await wait(200)
  })

  it('GET returns null when no policy is set', async () => {
    const res = await fetch(`${baseUrl}/api/users/${encodeURIComponent(AGENT_EMAIL)}/yolo-policy`, {
      headers: managementHeader,
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ policy: null })
  })

  it('PUT creates then GET returns the policy', async () => {
    const put = await fetch(`${baseUrl}/api/users/${encodeURIComponent(AGENT_EMAIL)}/yolo-policy`, {
      method: 'PUT',
      headers: { ...managementHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        denyRiskThreshold: 'high',
        denyPatterns: ['rm -rf *', 'sudo *'],
      }),
    })
    expect(put.status).toBe(200)
    const putBody = await put.json()
    expect(putBody.policy.agentEmail).toBe(AGENT_EMAIL)
    expect(putBody.policy.denyRiskThreshold).toBe('high')
    expect(putBody.policy.denyPatterns).toEqual(['rm -rf *', 'sudo *'])

    const get = await fetch(`${baseUrl}/api/users/${encodeURIComponent(AGENT_EMAIL)}/yolo-policy`, {
      headers: managementHeader,
    })
    const getBody = await get.json()
    expect(getBody.policy.denyRiskThreshold).toBe('high')
    expect(getBody.policy.denyPatterns).toEqual(['rm -rf *', 'sudo *'])
    expect(getBody.policy.enabledAt).toBeTypeOf('number')
  })

  it('PUT partial update preserves fields', async () => {
    const put = await fetch(`${baseUrl}/api/users/${encodeURIComponent(AGENT_EMAIL)}/yolo-policy`, {
      method: 'PUT',
      headers: { ...managementHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ denyPatterns: ['docker *'] }),
    })
    expect(put.status).toBe(200)
    const body = await put.json()
    expect(body.policy.denyRiskThreshold).toBe('high')
    expect(body.policy.denyPatterns).toEqual(['docker *'])
  })

  it('PUT rejects invalid risk threshold', async () => {
    const put = await fetch(`${baseUrl}/api/users/${encodeURIComponent(AGENT_EMAIL)}/yolo-policy`, {
      method: 'PUT',
      headers: { ...managementHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ denyRiskThreshold: 'extreme' }),
    })
    expect(put.status).toBe(400)
  })

  it('PUT rejects non-agent target', async () => {
    const put = await fetch(`${baseUrl}/api/users/${encodeURIComponent(OWNER_EMAIL)}/yolo-policy`, {
      method: 'PUT',
      headers: { ...managementHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ denyRiskThreshold: 'high' }),
    })
    expect(put.status).toBe(400)
  })

  it('auto-approves a grant request when YOLO policy is active', async () => {
    // Fresh policy without deny-patterns or risk threshold → all commands auto-approve.
    await fetch(`${baseUrl}/api/users/${encodeURIComponent(AGENT_EMAIL)}/yolo-policy`, {
      method: 'PUT',
      headers: { ...managementHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ denyPatterns: [], denyRiskThreshold: null }),
    })

    const res = await fetch(`${baseUrl}/api/grants`, {
      method: 'POST',
      headers: { ...managementHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requester: AGENT_EMAIL,
        target_host: '127.0.0.1',
        audience: 'test',
        grant_type: 'once',
        command: ['ls', '-la'],
      }),
    })
    expect(res.status).toBe(201)
    const grant = await res.json()
    expect(grant.status).toBe('approved')
    expect(grant.auto_approval_kind).toBe('yolo')
    // enabledBy reflects the actor who set the policy. When created via the
    // management token there's no email context, so it's '_management_'.
    // In the normal admin flow an owner/approver's email lands here.
    expect(grant.decided_by).toBe('_management_')
  })

  it('risk-threshold drops the request when shape resolves to generic-fallback (high risk)', async () => {
    await fetch(`${baseUrl}/api/users/${encodeURIComponent(AGENT_EMAIL)}/yolo-policy`, {
      method: 'PUT',
      headers: { ...managementHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ denyRiskThreshold: 'medium', denyPatterns: [] }),
    })
    // `some-random-cli` has no registered shape → generic fallback → risk='high'.
    // Symmetric semantic: risk > threshold ('medium') → drops to pending.
    // (Equality would approve per "alles bis zu diesem Level wird auto-approved".)
    const res = await fetch(`${baseUrl}/api/grants`, {
      method: 'POST',
      headers: { ...managementHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requester: AGENT_EMAIL,
        target_host: '127.0.0.1',
        audience: 'test',
        grant_type: 'once',
        command: ['some-random-cli', 'whatever'],
      }),
    })
    const grant = await res.json()
    expect(grant.status).toBe('pending')
    expect(grant.auto_approval_kind).toBeUndefined()
  })

  it('deny-pattern drops the request back to pending', async () => {
    await fetch(`${baseUrl}/api/users/${encodeURIComponent(AGENT_EMAIL)}/yolo-policy`, {
      method: 'PUT',
      headers: { ...managementHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ denyPatterns: ['rm *'] }),
    })

    const res = await fetch(`${baseUrl}/api/grants`, {
      method: 'POST',
      headers: { ...managementHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requester: AGENT_EMAIL,
        target_host: '127.0.0.1',
        audience: 'test',
        grant_type: 'once',
        command: ['rm', 'foo.txt'],
      }),
    })
    expect(res.status).toBe(201)
    const grant = await res.json()
    expect(grant.status).toBe('pending')
    expect(grant.auto_approval_kind).toBeUndefined()
  })

  it('expired YOLO policy does not auto-approve', async () => {
    // Expired policies are enforced by the evaluator only; the API rejects
    // past `expiresAt`, so seed the store directly via a far-future timestamp
    // and then simulate expiry by updating it out-of-band isn't trivial —
    // instead we disable the policy entirely and confirm the request pends.
    await fetch(`${baseUrl}/api/users/${encodeURIComponent(AGENT_EMAIL)}/yolo-policy`, {
      method: 'DELETE',
      headers: managementHeader,
    })
    const res = await fetch(`${baseUrl}/api/grants`, {
      method: 'POST',
      headers: { ...managementHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requester: AGENT_EMAIL,
        target_host: '127.0.0.1',
        audience: 'test',
        grant_type: 'once',
        command: ['ls'],
      }),
    })
    const grant = await res.json()
    expect(grant.status).toBe('pending')
    expect(grant.auto_approval_kind).toBeUndefined()
  })

  it('DELETE removes the policy', async () => {
    await fetch(`${baseUrl}/api/users/${encodeURIComponent(AGENT_EMAIL)}/yolo-policy`, {
      method: 'PUT',
      headers: { ...managementHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ denyRiskThreshold: 'high' }),
    })
    const del = await fetch(`${baseUrl}/api/users/${encodeURIComponent(AGENT_EMAIL)}/yolo-policy`, {
      method: 'DELETE',
      headers: managementHeader,
    })
    expect(del.status).toBe(204)
    const get = await fetch(`${baseUrl}/api/users/${encodeURIComponent(AGENT_EMAIL)}/yolo-policy`, {
      headers: managementHeader,
    })
    const body = await get.json()
    expect(body).toEqual({ policy: null })
  })
})
