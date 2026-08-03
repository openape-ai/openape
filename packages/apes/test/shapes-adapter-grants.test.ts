import type { RunningServer } from 'openape-e2e/lifecycle'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateKeyPairSync } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { startIdp } from 'openape-e2e/idp-fixture'

// ---------------------------------------------------------------------------
// Isolate HOME to tmpdir
// ---------------------------------------------------------------------------

const testHome = join(tmpdir(), `apes-shapes-grants-${process.pid}-${Date.now()}`)
mkdirSync(testHome, { recursive: true })

vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>()
  return { ...original, homedir: () => testHome }
})

// ---------------------------------------------------------------------------
// Fixtures path (still in apes)
// ---------------------------------------------------------------------------

const FIXTURES_DIR = join(__dirname, 'fixtures')

// ---------------------------------------------------------------------------
// Test 5: findExistingGrant matching (needs a running IdP)
// Uses the shapes-local config (shapes-local getIdpUrl / getAuthToken) — but
// findExistingGrant is the STAYER in apes/shapes/grants.ts; it calls
// @openape/shapes http functions (moved) which in turn read config.
// ---------------------------------------------------------------------------

describe('shapes adapter: findExistingGrant', () => {
  let server: RunningServer
  let idpBase: string
  const MGMT_TOKEN = 'test-mgmt-shapes'

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

  const agentEmail = 'shapes-agent@example.com'
  const ownerEmail = 'shapes-owner@example.com'
  const kp = generateTestKeyPair()

  beforeAll(async () => {
    // Write agent key
    writeFileSync(join(testHome, 'test_key'), kp.privateKeyPem, { mode: 0o600 })

    server = await startIdp({ managementToken: MGMT_TOKEN, adminEmails: [ownerEmail] })
    idpBase = server.url
    process.env.APES_IDP = idpBase

    // Register the agent through the admin API rather than /api/auth/enroll:
    // enrolment also seeds the 14 default safe-command standing grants, and
    // `grep` is one of them. Those would auto-approve the grants below and
    // pre-empt the reuse lookup this suite is about.
    const createRes = await fetch(`${idpBase}/api/admin/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MGMT_TOKEN}` },
      body: JSON.stringify({
        email: agentEmail,
        name: 'Shapes Agent',
        publicKey: kp.publicKeySsh,
        owner: ownerEmail,
        approver: ownerEmail,
      }),
    })
    if (!createRes.ok) throw new Error(`Agent creation failed: ${await createRes.text()}`)

    // Login via apes
    const { loginCommand } = await import('../src/commands/auth/login')
    await loginCommand.run!({ args: { idp: idpBase, key: join(testHome, 'test_key'), email: agentEmail } } as any)
  })

  afterAll(async () => {
    delete process.env.APES_IDP
    await server.stop()
    rmSync(testHome, { recursive: true, force: true })
  })

  it('finds an existing timed grant that covers the resolved command', async () => {
    const { loadAdapter } = await import('@openape/shapes')
    const { resolveCommand } = await import('@openape/shapes')
    const { findExistingGrant } = await import('../src/shapes/grants.js')

    const loaded = loadAdapter('grep', join(FIXTURES_DIR, 'grep.toml'))

    // Resolve a command to get the authorization detail
    const resolved = await resolveCommand(loaded, ['grep', 'TODO', '/src'])

    // Create a timed grant via the IdP with matching authorization_details
    const createRes = await fetch(`${idpBase}/api/grants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MGMT_TOKEN}` },
      body: JSON.stringify({
        requester: agentEmail,
        target_host: 'test-host',
        audience: 'shapes',
        grant_type: 'timed',
        duration: 3600,
        command: ['grep', 'TODO', '/src'],
        permissions: [resolved.permission],
        authorization_details: [resolved.detail],
        execution_context: resolved.executionContext,
        reason: 'test timed grant',
      }),
    })
    expect(createRes.status).toBe(201)
    const created = await createRes.json() as { id: string }

    // Approve it
    const approveRes = await fetch(`${idpBase}/api/grants/${created.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MGMT_TOKEN}` },
      body: JSON.stringify({ grant_type: 'timed', duration: 3600 }),
    })
    expect(approveRes.ok).toBe(true)

    // Now resolve a SIMILAR command (same operation, same path)
    const resolved2 = await resolveCommand(loaded, ['grep', 'TODO', '/src'])

    // findExistingGrant should find the timed grant
    const existingId = await findExistingGrant(resolved2, idpBase)
    expect(existingId).toBe(created.id)
  })

  it('does not find a once grant for reuse', async () => {
    const { loadAdapter, resolveCommand } = await import('@openape/shapes')
    const { findExistingGrant } = await import('../src/shapes/grants.js')

    const loaded = loadAdapter('grep', join(FIXTURES_DIR, 'grep.toml'))

    // Create a once grant
    const resolved = await resolveCommand(loaded, ['grep', '-r', 'FIXME', '/app'])

    const createRes = await fetch(`${idpBase}/api/grants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MGMT_TOKEN}` },
      body: JSON.stringify({
        requester: agentEmail,
        target_host: 'test-host',
        audience: 'shapes',
        grant_type: 'once',
        command: ['grep', '-r', 'FIXME', '/app'],
        permissions: [resolved.permission],
        authorization_details: [resolved.detail],
        reason: 'once grant test',
      }),
    })
    expect(createRes.status).toBe(201)
    const created = await createRes.json() as { id: string }

    // Approve it
    await fetch(`${idpBase}/api/grants/${created.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MGMT_TOKEN}` },
      body: JSON.stringify({}),
    })

    // findExistingGrant should NOT return this once-grant
    const resolved2 = await resolveCommand(loaded, ['grep', '-r', 'FIXME', '/app'])
    const existingId = await findExistingGrant(resolved2, idpBase)
    // Should not match the once grant
    if (existingId) {
      expect(existingId).not.toBe(created.id)
    }
  })

  it('does not find a grant with mismatched audience', async () => {
    const { loadAdapter, resolveCommand } = await import('@openape/shapes')
    const { findExistingGrant } = await import('../src/shapes/grants.js')

    const loaded = loadAdapter('grep', join(FIXTURES_DIR, 'grep.toml'))

    // Create a timed grant with a DIFFERENT audience
    const createRes = await fetch(`${idpBase}/api/grants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MGMT_TOKEN}` },
      body: JSON.stringify({
        requester: agentEmail,
        target_host: 'test-host',
        audience: 'wrong-audience',
        grant_type: 'timed',
        duration: 3600,
        command: ['grep', 'test', '/etc'],
        reason: 'wrong audience test',
      }),
    })
    expect(createRes.status).toBe(201)
    const created = await createRes.json() as { id: string }

    await fetch(`${idpBase}/api/grants/${created.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MGMT_TOKEN}` },
      body: JSON.stringify({ grant_type: 'timed', duration: 3600 }),
    })

    // Use the grep adapter which expects audience "shapes"
    const resolved = await resolveCommand(loaded, ['grep', 'test', '/etc'])
    const existingId = await findExistingGrant(resolved, idpBase)

    // Should not match the wrong-audience grant
    if (existingId) {
      expect(existingId).not.toBe(created.id)
    }
  })
})
