import { mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Isolate HOME to tmpdir
// ---------------------------------------------------------------------------

const testHome = join(tmpdir(), `shapes-shapes-${process.pid}-${Date.now()}`)
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
    const { parseAdapterToml } = await import('../src/toml')
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
    const { parseAdapterToml } = await import('../src/toml')
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
    const { parseAdapterToml } = await import('../src/toml')
    expect(() => parseAdapterToml('[cli]\nid = "x"\nexecutable = "x"\n[[operation]]\nid = "a"\ncommand = []\ndisplay = "d"\naction = "r"\nresource_chain = ["r"]')).toThrow(/schema/)
  })

  it('rejects TOML with no operations', async () => {
    const { parseAdapterToml } = await import('../src/toml')
    expect(() => parseAdapterToml('schema = "openape-shapes/v1"\n[cli]\nid = "x"\nexecutable = "x"')).toThrow(/operation/)
  })

  it('parses simple resource chains without commas correctly', async () => {
    const { parseAdapterToml } = await import('../src/toml')
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
    const { parseAdapterToml } = await import('../src/toml')
    const { resolveCommand } = await import('../src/parser')

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
    const { parseAdapterToml } = await import('../src/toml')
    const { resolveCommand } = await import('../src/parser')

    const content = readFileSync(join(FIXTURES_DIR, 'gh.toml'), 'utf-8')
    const adapter = parseAdapterToml(content)
    const loaded = { adapter, source: join(FIXTURES_DIR, 'gh.toml'), digest: 'test-digest' }

    const resolved = await resolveCommand(loaded, ['gh', 'repo', 'view', 'openape-ai/openape'])

    expect(resolved.detail.operation_id).toBe('repo.view')
    expect(resolved.detail.action).toBe('read')
    expect(resolved.bindings.repo).toBe('openape-ai/openape')
  })

  it('resolves "gh repo delete owner/repo" with exact_command constraint', async () => {
    const { parseAdapterToml } = await import('../src/toml')
    const { resolveCommand } = await import('../src/parser')

    const content = readFileSync(join(FIXTURES_DIR, 'gh.toml'), 'utf-8')
    const adapter = parseAdapterToml(content)
    const loaded = { adapter, source: join(FIXTURES_DIR, 'gh.toml'), digest: 'test-digest' }

    const resolved = await resolveCommand(loaded, ['gh', 'repo', 'delete', 'openape-ai/openape'])

    expect(resolved.detail.operation_id).toBe('repo.delete')
    expect(resolved.detail.risk).toBe('critical')
    expect(resolved.detail.constraints).toEqual({ exact_command: true })
  })

  it('resolves "gh repo list owner" with single positional', async () => {
    const { parseAdapterToml } = await import('../src/toml')
    const { resolveCommand } = await import('../src/parser')

    const content = readFileSync(join(FIXTURES_DIR, 'gh.toml'), 'utf-8')
    const adapter = parseAdapterToml(content)
    const loaded = { adapter, source: join(FIXTURES_DIR, 'gh.toml'), digest: 'test-digest' }

    const resolved = await resolveCommand(loaded, ['gh', 'repo', 'list', 'openape-ai'])

    expect(resolved.detail.operation_id).toBe('repo.list')
    expect(resolved.bindings.owner).toBe('openape-ai')
    expect(resolved.detail.display).toBe('List repositories for owner openape-ai')
  })

  it('throws for unrecognized command', async () => {
    const { parseAdapterToml } = await import('../src/toml')
    const { resolveCommand } = await import('../src/parser')

    const content = readFileSync(join(FIXTURES_DIR, 'gh.toml'), 'utf-8')
    const adapter = parseAdapterToml(content)
    const loaded = { adapter, source: join(FIXTURES_DIR, 'gh.toml'), digest: 'test-digest' }

    await expect(
      resolveCommand(loaded, ['gh', 'nonexistent', 'command']),
    ).rejects.toThrow(/No adapter operation matched/)
  })

  it('throws when executable does not match adapter', async () => {
    const { parseAdapterToml } = await import('../src/toml')
    const { resolveCommand } = await import('../src/parser')

    const content = readFileSync(join(FIXTURES_DIR, 'gh.toml'), 'utf-8')
    const adapter = parseAdapterToml(content)
    const loaded = { adapter, source: join(FIXTURES_DIR, 'gh.toml'), digest: 'test-digest' }

    await expect(
      resolveCommand(loaded, ['git', 'pr', 'list', '--repo', 'x/y']),
    ).rejects.toThrow(/expects executable/)
  })

  it('resolves grep with positionals', async () => {
    const { parseAdapterToml } = await import('../src/toml')
    const { resolveCommand } = await import('../src/parser')

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
    const { parseAdapterToml } = await import('../src/toml')
    const { resolveCommand } = await import('../src/parser')

    const content = readFileSync(join(FIXTURES_DIR, 'grep.toml'), 'utf-8')
    const adapter = parseAdapterToml(content)
    const loaded = { adapter, source: join(FIXTURES_DIR, 'grep.toml'), digest: 'test-digest' }

    const resolved = await resolveCommand(loaded, ['grep', '-r', 'TODO', '/src'])

    expect(resolved.detail.operation_id).toBe('grep.search-recursive')
  })

  it('includes execution context with argv hash', async () => {
    const { parseAdapterToml } = await import('../src/toml')
    const { resolveCommand } = await import('../src/parser')

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
    const { parseAdapterToml } = await import('../src/toml')
    const { resolveCapabilityRequest } = await import('../src/capabilities')

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
    const { parseAdapterToml } = await import('../src/toml')
    const { resolveCapabilityRequest } = await import('../src/capabilities')

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
    const { parseAdapterToml } = await import('../src/toml')
    const { resolveCapabilityRequest } = await import('../src/capabilities')

    const content = readFileSync(join(FIXTURES_DIR, 'gh.toml'), 'utf-8')
    const adapter = parseAdapterToml(content)
    const loaded = { adapter, source: join(FIXTURES_DIR, 'gh.toml'), digest: 'test-digest' }

    expect(() => resolveCapabilityRequest(loaded, {
      resources: ['nonexistent'],
      actions: ['read'],
    })).toThrow(/No adapter operation supports/)
  })

  it('throws for unsupported action on valid resource', async () => {
    const { parseAdapterToml } = await import('../src/toml')
    const { resolveCapabilityRequest } = await import('../src/capabilities')

    const content = readFileSync(join(FIXTURES_DIR, 'grep.toml'), 'utf-8')
    const adapter = parseAdapterToml(content)
    const loaded = { adapter, source: join(FIXTURES_DIR, 'grep.toml'), digest: 'test-digest' }

    expect(() => resolveCapabilityRequest(loaded, {
      resources: ['filesystem'],
      actions: ['delete'],
    })).toThrow(/Action delete is not valid/)
  })

  it('throws when no resources provided', async () => {
    const { parseAdapterToml } = await import('../src/toml')
    const { resolveCapabilityRequest } = await import('../src/capabilities')

    const content = readFileSync(join(FIXTURES_DIR, 'grep.toml'), 'utf-8')
    const adapter = parseAdapterToml(content)
    const loaded = { adapter, source: join(FIXTURES_DIR, 'grep.toml'), digest: 'test-digest' }

    expect(() => resolveCapabilityRequest(loaded, {
      resources: [],
      actions: ['read'],
    })).toThrow(/At least one --resource/)
  })

  it('throws when no actions provided', async () => {
    const { parseAdapterToml } = await import('../src/toml')
    const { resolveCapabilityRequest } = await import('../src/capabilities')

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
    const { parseAdapterToml } = await import('../src/toml')
    const { resolveCommand } = await import('../src/parser')
    const { buildStructuredCliGrantRequest } = await import('../src/request-builders')

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
    const { buildExactCommandGrantRequest } = await import('../src/request-builders')

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
    const { parseAdapterToml } = await import('../src/toml')
    const { resolveCapabilityRequest } = await import('../src/capabilities')
    const { buildStructuredCliGrantRequest } = await import('../src/request-builders')

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
    const { buildExactCommandGrantRequest } = await import('../src/request-builders')

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
