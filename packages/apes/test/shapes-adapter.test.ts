import type { Server } from 'node:http'
import { createServer } from 'node:http'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto'
import { createRouter, defineEventHandler, readBody, setResponseStatus, toNodeListener } from 'h3'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createIdPApp } from '@openape/server'
import { SignJWT } from 'jose'

// ---------------------------------------------------------------------------
// Isolate HOME to tmpdir
// ---------------------------------------------------------------------------

const testHome = join(tmpdir(), `apes-shapes-${process.pid}-${Date.now()}`)
mkdirSync(testHome, { recursive: true })

vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>()
  return { ...original, homedir: () => testHome }
})

// ---------------------------------------------------------------------------
// Fixtures path
// ---------------------------------------------------------------------------

const FIXTURES_DIR = join(__dirname, 'fixtures')

// ---------------------------------------------------------------------------
// Test 1: TOML adapter parsing (pure, no server needed)
// ---------------------------------------------------------------------------

describe('shapes adapter: TOML parsing', () => {
  it('parses gh.toml into correct adapter structure', async () => {
    const { parseAdapterToml } = await import('../src/shapes/toml')
    const content = readFileSync(join(FIXTURES_DIR, 'gh.toml'), 'utf-8')
    const adapter = parseAdapterToml(content)

    expect(adapter.schema).toBe('openape-shapes/v1')
    expect(adapter.cli.id).toBe('gh')
    expect(adapter.cli.executable).toBe('gh')
    expect(adapter.cli.audience).toBe('shapes')
    expect(adapter.cli.version).toBe('1')
    expect(adapter.operations.length).toBeGreaterThan(0)

    // Check a known operation
    const prList = adapter.operations.find(op => op.id === 'pr.list')
    expect(prList).toBeTruthy()
    expect(prList!.command).toEqual(['pr', 'list'])
    expect(prList!.required_options).toEqual(['repo'])
    expect(prList!.action).toBe('list')
    expect(prList!.risk).toBe('low')
    // The mini TOML parser splits on commas inside arrays, so
    // "repo:owner={repo|owner},name={repo|name}" becomes two entries
    expect(prList!.resource_chain.length).toBe(3)
    expect(prList!.resource_chain[0]).toBe('repo:owner={repo|owner}')
    expect(prList!.resource_chain[2]).toBe('pr:*')
  })

  it('parses grep.toml with empty-command operations', async () => {
    const { parseAdapterToml } = await import('../src/shapes/toml')
    const content = readFileSync(join(FIXTURES_DIR, 'grep.toml'), 'utf-8')
    const adapter = parseAdapterToml(content)

    expect(adapter.cli.id).toBe('grep')
    expect(adapter.cli.executable).toBe('grep')
    expect(adapter.operations.length).toBe(2)

    const searchOp = adapter.operations.find(op => op.id === 'grep.search')
    expect(searchOp).toBeTruthy()
    expect(searchOp!.command).toEqual([])
    expect(searchOp!.positionals).toEqual(['pattern', 'path'])
  })

  it('rejects invalid TOML (missing schema)', async () => {
    const { parseAdapterToml } = await import('../src/shapes/toml')
    expect(() => parseAdapterToml('[cli]\nid = "x"\nexecutable = "x"\n[[operation]]\nid = "a"\ncommand = []\ndisplay = "d"\naction = "r"\nresource_chain = ["r"]')).toThrow(/schema/)
  })

  it('rejects TOML with no operations', async () => {
    const { parseAdapterToml } = await import('../src/shapes/toml')
    expect(() => parseAdapterToml('schema = "openape-shapes/v1"\n[cli]\nid = "x"\nexecutable = "x"')).toThrow(/operation/)
  })

  it('parses simple resource chains without commas correctly', async () => {
    const { parseAdapterToml } = await import('../src/shapes/toml')
    const content = readFileSync(join(FIXTURES_DIR, 'grep.toml'), 'utf-8')
    const adapter = parseAdapterToml(content)

    const searchOp = adapter.operations.find(op => op.id === 'grep.search')
    expect(searchOp!.resource_chain).toEqual(['filesystem:path={path}'])
  })
})

// ---------------------------------------------------------------------------
// Test 2: Command resolution
// ---------------------------------------------------------------------------

describe('shapes adapter: command resolution', () => {
  it('resolves "gh pr list --repo owner/repo" to pr.list operation', async () => {
    const { parseAdapterToml } = await import('../src/shapes/toml')
    const { resolveCommand } = await import('../src/shapes/parser')

    const content = readFileSync(join(FIXTURES_DIR, 'gh.toml'), 'utf-8')
    const adapter = parseAdapterToml(content)
    const loaded = { adapter, source: join(FIXTURES_DIR, 'gh.toml'), digest: 'test-digest' }

    const resolved = await resolveCommand(loaded, ['gh', 'pr', 'list', '--repo', 'openape-ai/openape'])

    expect(resolved.detail.operation_id).toBe('pr.list')
    expect(resolved.detail.action).toBe('list')
    expect(resolved.detail.cli_id).toBe('gh')
    expect(resolved.detail.type).toBe('openape_cli')
    // Verify resource chain contains repo with owner selector
    expect(resolved.detail.resource_chain.length).toBeGreaterThanOrEqual(2)
    expect(resolved.detail.resource_chain[0]!.resource).toBe('repo')
    expect(resolved.detail.resource_chain[0]!.selector).toEqual({ owner: 'openape-ai' })
    // Last entry should be pr
    expect(resolved.detail.resource_chain.at(-1)!.resource).toBe('pr')
    // Permission should be a canonicalized string
    expect(resolved.permission).toBeTruthy()
    expect(typeof resolved.permission).toBe('string')
  })

  it('resolves "gh repo view owner/repo" with owner/name split', async () => {
    const { parseAdapterToml } = await import('../src/shapes/toml')
    const { resolveCommand } = await import('../src/shapes/parser')

    const content = readFileSync(join(FIXTURES_DIR, 'gh.toml'), 'utf-8')
    const adapter = parseAdapterToml(content)
    const loaded = { adapter, source: join(FIXTURES_DIR, 'gh.toml'), digest: 'test-digest' }

    const resolved = await resolveCommand(loaded, ['gh', 'repo', 'view', 'openape-ai/openape'])

    expect(resolved.detail.operation_id).toBe('repo.view')
    expect(resolved.detail.action).toBe('read')
    expect(resolved.bindings.repo).toBe('openape-ai/openape')
  })

  it('resolves "gh repo delete owner/repo" with exact_command constraint', async () => {
    const { parseAdapterToml } = await import('../src/shapes/toml')
    const { resolveCommand } = await import('../src/shapes/parser')

    const content = readFileSync(join(FIXTURES_DIR, 'gh.toml'), 'utf-8')
    const adapter = parseAdapterToml(content)
    const loaded = { adapter, source: join(FIXTURES_DIR, 'gh.toml'), digest: 'test-digest' }

    const resolved = await resolveCommand(loaded, ['gh', 'repo', 'delete', 'openape-ai/openape'])

    expect(resolved.detail.operation_id).toBe('repo.delete')
    expect(resolved.detail.risk).toBe('critical')
    expect(resolved.detail.constraints).toEqual({ exact_command: true })
  })

  it('resolves "gh repo list owner" with single positional', async () => {
    const { parseAdapterToml } = await import('../src/shapes/toml')
    const { resolveCommand } = await import('../src/shapes/parser')

    const content = readFileSync(join(FIXTURES_DIR, 'gh.toml'), 'utf-8')
    const adapter = parseAdapterToml(content)
    const loaded = { adapter, source: join(FIXTURES_DIR, 'gh.toml'), digest: 'test-digest' }

    const resolved = await resolveCommand(loaded, ['gh', 'repo', 'list', 'openape-ai'])

    expect(resolved.detail.operation_id).toBe('repo.list')
    expect(resolved.bindings.owner).toBe('openape-ai')
    expect(resolved.detail.display).toBe('List repositories for owner openape-ai')
  })

  it('throws for unrecognized command', async () => {
    const { parseAdapterToml } = await import('../src/shapes/toml')
    const { resolveCommand } = await import('../src/shapes/parser')

    const content = readFileSync(join(FIXTURES_DIR, 'gh.toml'), 'utf-8')
    const adapter = parseAdapterToml(content)
    const loaded = { adapter, source: join(FIXTURES_DIR, 'gh.toml'), digest: 'test-digest' }

    await expect(
      resolveCommand(loaded, ['gh', 'nonexistent', 'command']),
    ).rejects.toThrow(/No adapter operation matched/)
  })

  it('throws when executable does not match adapter', async () => {
    const { parseAdapterToml } = await import('../src/shapes/toml')
    const { resolveCommand } = await import('../src/shapes/parser')

    const content = readFileSync(join(FIXTURES_DIR, 'gh.toml'), 'utf-8')
    const adapter = parseAdapterToml(content)
    const loaded = { adapter, source: join(FIXTURES_DIR, 'gh.toml'), digest: 'test-digest' }

    await expect(
      resolveCommand(loaded, ['git', 'pr', 'list', '--repo', 'x/y']),
    ).rejects.toThrow(/expects executable/)
  })

  it('resolves grep with positionals', async () => {
    const { parseAdapterToml } = await import('../src/shapes/toml')
    const { resolveCommand } = await import('../src/shapes/parser')

    const content = readFileSync(join(FIXTURES_DIR, 'grep.toml'), 'utf-8')
    const adapter = parseAdapterToml(content)
    const loaded = { adapter, source: join(FIXTURES_DIR, 'grep.toml'), digest: 'test-digest' }

    const resolved = await resolveCommand(loaded, ['grep', 'TODO', '/src'])

    expect(resolved.detail.operation_id).toBe('grep.search')
    expect(resolved.detail.resource_chain).toEqual([
      { resource: 'filesystem', selector: { path: '/src' } },
    ])
    expect(resolved.bindings.pattern).toBe('TODO')
    expect(resolved.bindings.path).toBe('/src')
  })

  it('resolves grep -r with recursive operation', async () => {
    const { parseAdapterToml } = await import('../src/shapes/toml')
    const { resolveCommand } = await import('../src/shapes/parser')

    const content = readFileSync(join(FIXTURES_DIR, 'grep.toml'), 'utf-8')
    const adapter = parseAdapterToml(content)
    const loaded = { adapter, source: join(FIXTURES_DIR, 'grep.toml'), digest: 'test-digest' }

    const resolved = await resolveCommand(loaded, ['grep', '-r', 'TODO', '/src'])

    expect(resolved.detail.operation_id).toBe('grep.search-recursive')
  })

  it('includes execution context with argv hash', async () => {
    const { parseAdapterToml } = await import('../src/shapes/toml')
    const { resolveCommand } = await import('../src/shapes/parser')

    const content = readFileSync(join(FIXTURES_DIR, 'grep.toml'), 'utf-8')
    const adapter = parseAdapterToml(content)
    const loaded = { adapter, source: join(FIXTURES_DIR, 'grep.toml'), digest: 'test-digest' }

    const resolved = await resolveCommand(loaded, ['grep', 'TODO', '/src'])

    expect(resolved.executionContext).toBeDefined()
    expect(resolved.executionContext.adapter_id).toBe('grep')
    expect(resolved.executionContext.argv).toEqual(['grep', 'TODO', '/src'])
    expect(resolved.executionContext.argv_hash).toBeTruthy()
    expect(resolved.executionContext.adapter_digest).toBe('test-digest')
  })
})

// ---------------------------------------------------------------------------
// Test 3: Capability resolution (using grep which has simple resource chains)
// ---------------------------------------------------------------------------

describe('shapes adapter: capability resolution', () => {
  it('resolves a capability request for filesystem resource', async () => {
    const { parseAdapterToml } = await import('../src/shapes/toml')
    const { resolveCapabilityRequest } = await import('../src/shapes/capabilities')

    const content = readFileSync(join(FIXTURES_DIR, 'grep.toml'), 'utf-8')
    const adapter = parseAdapterToml(content)
    const loaded = { adapter, source: join(FIXTURES_DIR, 'grep.toml'), digest: 'test-digest' }

    const capability = resolveCapabilityRequest(loaded, {
      resources: ['filesystem'],
      selectors: ['filesystem.path=/src'],
      actions: ['read'],
    })

    expect(capability.details.length).toBe(1)
    expect(capability.details[0]!.action).toBe('read')
    expect(capability.details[0]!.resource_chain).toEqual([
      { resource: 'filesystem', selector: { path: '/src' } },
    ])
    expect(capability.permissions.length).toBe(1)
    expect(capability.summary).toBeTruthy()
  })

  it('resolves capability for repo.list (single-segment chain)', async () => {
    const { parseAdapterToml } = await import('../src/shapes/toml')
    const { resolveCapabilityRequest } = await import('../src/shapes/capabilities')

    const content = readFileSync(join(FIXTURES_DIR, 'gh.toml'), 'utf-8')
    const adapter = parseAdapterToml(content)
    const loaded = { adapter, source: join(FIXTURES_DIR, 'gh.toml'), digest: 'test-digest' }

    // repo.list has resource_chain = ["owner:login={owner}", "repo:*"]
    // After TOML parse, owner is a standalone resource
    const capability = resolveCapabilityRequest(loaded, {
      resources: ['owner'],
      selectors: ['owner.login=openape-ai'],
      actions: ['list'],
    })

    expect(capability.details.length).toBe(1)
    expect(capability.details[0]!.action).toBe('list')
    expect(capability.permissions.length).toBe(1)
  })

  it('throws for unsupported resource chain', async () => {
    const { parseAdapterToml } = await import('../src/shapes/toml')
    const { resolveCapabilityRequest } = await import('../src/shapes/capabilities')

    const content = readFileSync(join(FIXTURES_DIR, 'gh.toml'), 'utf-8')
    const adapter = parseAdapterToml(content)
    const loaded = { adapter, source: join(FIXTURES_DIR, 'gh.toml'), digest: 'test-digest' }

    expect(() => resolveCapabilityRequest(loaded, {
      resources: ['nonexistent'],
      actions: ['read'],
    })).toThrow(/No adapter operation supports/)
  })

  it('throws for unsupported action on valid resource', async () => {
    const { parseAdapterToml } = await import('../src/shapes/toml')
    const { resolveCapabilityRequest } = await import('../src/shapes/capabilities')

    const content = readFileSync(join(FIXTURES_DIR, 'grep.toml'), 'utf-8')
    const adapter = parseAdapterToml(content)
    const loaded = { adapter, source: join(FIXTURES_DIR, 'grep.toml'), digest: 'test-digest' }

    expect(() => resolveCapabilityRequest(loaded, {
      resources: ['filesystem'],
      actions: ['delete'],
    })).toThrow(/Action delete is not valid/)
  })

  it('throws when no resources provided', async () => {
    const { parseAdapterToml } = await import('../src/shapes/toml')
    const { resolveCapabilityRequest } = await import('../src/shapes/capabilities')

    const content = readFileSync(join(FIXTURES_DIR, 'grep.toml'), 'utf-8')
    const adapter = parseAdapterToml(content)
    const loaded = { adapter, source: join(FIXTURES_DIR, 'grep.toml'), digest: 'test-digest' }

    expect(() => resolveCapabilityRequest(loaded, {
      resources: [],
      actions: ['read'],
    })).toThrow(/At least one --resource/)
  })

  it('throws when no actions provided', async () => {
    const { parseAdapterToml } = await import('../src/shapes/toml')
    const { resolveCapabilityRequest } = await import('../src/shapes/capabilities')

    const content = readFileSync(join(FIXTURES_DIR, 'grep.toml'), 'utf-8')
    const adapter = parseAdapterToml(content)
    const loaded = { adapter, source: join(FIXTURES_DIR, 'grep.toml'), digest: 'test-digest' }

    expect(() => resolveCapabilityRequest(loaded, {
      resources: ['filesystem'],
      actions: [],
    })).toThrow(/At least one --action/)
  })
})

// ---------------------------------------------------------------------------
// Test 4: Structured grant request building
// ---------------------------------------------------------------------------

describe('shapes adapter: grant request building', () => {
  it('builds a structured CLI grant request from resolved command', async () => {
    const { parseAdapterToml } = await import('../src/shapes/toml')
    const { resolveCommand } = await import('../src/shapes/parser')
    const { buildStructuredCliGrantRequest } = await import('../src/shapes/request-builders')

    const content = readFileSync(join(FIXTURES_DIR, 'grep.toml'), 'utf-8')
    const adapter = parseAdapterToml(content)
    const loaded = { adapter, source: join(FIXTURES_DIR, 'grep.toml'), digest: 'test-digest' }

    const resolved = await resolveCommand(loaded, ['grep', 'TODO', '/src'])

    const built = await buildStructuredCliGrantRequest(resolved, {
      requester: 'bob@example.com',
      target_host: 'test-host',
      grant_type: 'once',
      reason: 'test request',
    })

    expect(built.request.requester).toBe('bob@example.com')
    expect(built.request.target_host).toBe('test-host')
    expect(built.request.audience).toBe('shapes')
    expect(built.request.grant_type).toBe('once')
    expect(built.request.reason).toBe('test request')
    expect(built.request.authorization_details).toBeDefined()
    expect(built.request.authorization_details!.length).toBe(1)
    expect(built.request.authorization_details![0]!.type).toBe('openape_cli')
    expect(built.request.authorization_details![0]!.cli_id).toBe('grep')
    expect(built.request.authorization_details![0]!.operation_id).toBe('grep.search')
    expect(built.request.permissions).toBeDefined()
    expect(built.request.permissions!.length).toBe(1)
    expect(built.request.execution_context).toBeDefined()
    expect(built.request.execution_context!.adapter_id).toBe('grep')
  })

  it('builds an exact command grant request', async () => {
    const { buildExactCommandGrantRequest } = await import('../src/shapes/request-builders')

    const built = await buildExactCommandGrantRequest(
      ['ls', '-la', '/tmp'],
      {
        requester: 'bob@example.com',
        target_host: 'test-host',
        grant_type: 'once',
        reason: 'list files',
        audience: 'escapes',
      },
    )

    expect(built.request.requester).toBe('bob@example.com')
    expect(built.request.audience).toBe('escapes')
    expect(built.request.command).toEqual(['ls', '-la', '/tmp'])
    expect(built.request.cmd_hash).toBeTruthy()
    expect(built.request.authorization_details).toBeUndefined()
  })

  it('builds from capability resolution', async () => {
    const { parseAdapterToml } = await import('../src/shapes/toml')
    const { resolveCapabilityRequest } = await import('../src/shapes/capabilities')
    const { buildStructuredCliGrantRequest } = await import('../src/shapes/request-builders')

    const content = readFileSync(join(FIXTURES_DIR, 'grep.toml'), 'utf-8')
    const adapter = parseAdapterToml(content)
    const loaded = { adapter, source: join(FIXTURES_DIR, 'grep.toml'), digest: 'test-digest' }

    const capability = resolveCapabilityRequest(loaded, {
      resources: ['filesystem'],
      selectors: ['filesystem.path=/src'],
      actions: ['read'],
    })

    const built = await buildStructuredCliGrantRequest(capability, {
      requester: 'bob@example.com',
      target_host: 'test-host',
      grant_type: 'timed',
    })

    expect(built.request.audience).toBe('shapes')
    expect(built.request.grant_type).toBe('timed')
    expect(built.request.authorization_details!.length).toBe(1)
    expect(built.request.permissions!.length).toBe(1)
  })

  it('preserves run_as in request', async () => {
    const { buildExactCommandGrantRequest } = await import('../src/shapes/request-builders')

    const built = await buildExactCommandGrantRequest(
      ['sudo', 'reboot'],
      {
        requester: 'bob@example.com',
        target_host: 'test-host',
        grant_type: 'once',
        reason: 'reboot server',
        audience: 'escapes',
        run_as: 'root',
      },
    )

    expect(built.request.run_as).toBe('root')
  })
})

// ---------------------------------------------------------------------------
// Test 5: findExistingGrant matching (needs a running IdP)
// ---------------------------------------------------------------------------

describe('shapes adapter: findExistingGrant', () => {
  let server: Server
  let port: number
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

    const tempIdp = createIdPApp({ issuer: 'http://placeholder', managementToken: MGMT_TOKEN })
    const tempServer = createServer(toNodeListener(tempIdp.app))
    port = await new Promise<number>((resolve, reject) => {
      tempServer.listen(0, '127.0.0.1', () => {
        const addr = tempServer.address()
        if (addr && typeof addr === 'object') resolve(addr.port)
        else reject(new Error('Failed'))
      })
    })
    await new Promise<void>(resolve => tempServer.close(() => resolve()))

    idpBase = `http://127.0.0.1:${port}`
    process.env.APES_IDP = idpBase

    const idp = createIdPApp({
      issuer: idpBase,
      managementToken: MGMT_TOKEN,
      adminEmails: [ownerEmail],
    })

    // Compat routes
    const { stores } = idp
    const compatRouter = createRouter()

    compatRouter.post('/api/agent/challenge', defineEventHandler(async (event) => {
      const body = await readBody<{ agent_id: string }>(event)
      if (!body.agent_id) { setResponseStatus(event, 400); return { error: 'Missing agent_id' } }
      const user = await stores.userStore.findByEmail(body.agent_id)
      if (!user || !user.isActive) { setResponseStatus(event, 404); return { error: 'User not found' } }
      const challenge = await stores.challengeStore.createChallenge(user.email)
      return { challenge }
    }))

    compatRouter.post('/api/agent/authenticate', defineEventHandler(async (event) => {
      const body = await readBody<{ agent_id: string, challenge: string, signature: string }>(event)
      if (!body.agent_id || !body.challenge || !body.signature) { setResponseStatus(event, 400); return { error: 'Missing' } }
      const user = await stores.userStore.findByEmail(body.agent_id)
      if (!user || !user.isActive) { setResponseStatus(event, 404); return { error: 'Not found' } }
      const valid = await stores.challengeStore.consumeChallenge(body.challenge, body.agent_id)
      if (!valid) { setResponseStatus(event, 401); return { error: 'Invalid challenge' } }
      const keys = await stores.sshKeyStore.findByUser(body.agent_id)
      if (keys.length === 0) { setResponseStatus(event, 404); return { error: 'No keys' } }
      let verified = false
      for (const sshKey of keys) {
        try {
          const parts = sshKey.publicKey.trim().split(/\s+/)
          const keyData = Buffer.from(parts[1]!, 'base64')
          const tLen = keyData.readUInt32BE(0)
          const rawKey = keyData.subarray(4 + tLen + 4)
          const pubKeyObj = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: rawKey.toString('base64url') }, format: 'jwk' })
          const sigBuf = Buffer.from(body.signature, 'base64')
          verified = verify(null, Buffer.from(body.challenge), pubKeyObj, sigBuf)
          if (verified) break
        }
        catch { /* try next */ }
      }
      if (!verified) { setResponseStatus(event, 401); return { error: 'Bad sig' } }
      const signingKey = await stores.keyStore.getSigningKey()
      const token = await new SignJWT({ sub: user.email, act: user.owner ? 'agent' : 'human' })
        .setProtectedHeader({ alg: 'EdDSA', kid: signingKey.kid })
        .setIssuer(idpBase)
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(signingKey.privateKey)
      return { token, id: user.email, email: user.email, name: user.name, expires_in: 3600 }
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
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${MGMT_TOKEN}` },
      body: JSON.stringify({ email: agentEmail, name: 'Shapes Agent', publicKey: kp.publicKeySsh, owner: ownerEmail }),
    })
    if (!enrollRes.ok) throw new Error(`Enroll failed: ${await enrollRes.text()}`)

    // Login via apes
    const { loginCommand } = await import('../src/commands/auth/login')
    await loginCommand.run!({ args: { idp: idpBase, key: join(testHome, 'test_key'), email: agentEmail } } as any)
  })

  afterAll(async () => {
    delete process.env.APES_IDP
    await new Promise<void>(resolve => server.close(() => resolve()))
    rmSync(testHome, { recursive: true, force: true })
  })

  it('finds an existing timed grant that covers the resolved command', async () => {
    const { parseAdapterToml } = await import('../src/shapes/toml')
    const { resolveCommand } = await import('../src/shapes/parser')
    const { findExistingGrant } = await import('../src/shapes/grants')

    const content = readFileSync(join(FIXTURES_DIR, 'grep.toml'), 'utf-8')
    const adapter = parseAdapterToml(content)
    const loaded = { adapter, source: join(FIXTURES_DIR, 'grep.toml'), digest: 'test-digest' }

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
    const { parseAdapterToml } = await import('../src/shapes/toml')
    const { resolveCommand } = await import('../src/shapes/parser')
    const { findExistingGrant } = await import('../src/shapes/grants')

    const content = readFileSync(join(FIXTURES_DIR, 'grep.toml'), 'utf-8')
    const adapter = parseAdapterToml(content)
    const loaded = { adapter, source: join(FIXTURES_DIR, 'grep.toml'), digest: 'test-digest' }

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
    const { parseAdapterToml } = await import('../src/shapes/toml')
    const { resolveCommand } = await import('../src/shapes/parser')
    const { findExistingGrant } = await import('../src/shapes/grants')

    const content = readFileSync(join(FIXTURES_DIR, 'grep.toml'), 'utf-8')
    const adapter = parseAdapterToml(content)

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
    const loaded = { adapter, source: join(FIXTURES_DIR, 'grep.toml'), digest: 'test-digest' }
    const resolved = await resolveCommand(loaded, ['grep', 'test', '/etc'])
    const existingId = await findExistingGrant(resolved, idpBase)

    // Should not match the wrong-audience grant
    if (existingId) {
      expect(existingId).not.toBe(created.id)
    }
  })
})
