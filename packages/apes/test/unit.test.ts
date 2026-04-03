/**
 * Unit tests for modules that are hard to test via in-process integration
 * because they require @openape/shapes adapters, MCP transport, or browser.
 * These use targeted mocking to exercise specific code paths.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import consola from 'consola'

const testHome = join(tmpdir(), `apes-unit-${process.pid}-${Date.now()}`)
mkdirSync(testHome, { recursive: true })

vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>()
  return { ...original, homedir: () => testHome }
})

// =========================================================================
// approve command
// =========================================================================

describe('approve command', () => {
  let logOutput: string[]

  beforeAll(() => {
    // Set up auth file for the commands
    const apesDir = join(testHome, '.config', 'apes')
    mkdirSync(apesDir, { recursive: true })
    writeFileSync(join(apesDir, 'auth.json'), JSON.stringify({
      idp: 'http://mock-idp.test',
      access_token: 'test-token-approve',
      email: 'agent+test@example.com',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    }, null, 2), { mode: 0o600 })
    process.env.APES_IDP = 'http://mock-idp.test'
  })

  beforeEach(() => {
    logOutput = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logOutput.push(args.map(String).join(' '))
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(() => {
    delete process.env.APES_IDP
    rmSync(testHome, { recursive: true, force: true })
  })

  it('calls apiFetch with correct approve URL', async () => {
    // Mock the http module
    const httpModule = await import('../src/http')
    const spy = vi.spyOn(httpModule, 'apiFetch').mockResolvedValueOnce({})
    vi.spyOn(httpModule, 'getGrantsEndpoint').mockResolvedValue('http://mock-idp.test/api/grants')

    const { approveCommand } = await import('../src/commands/grants/approve')
    const successSpy = vi.spyOn(consola, 'success')

    await approveCommand.run!({ args: { id: 'grant-123' } } as any)

    expect(spy).toHaveBeenCalledWith(
      'http://mock-idp.test/api/grants/grant-123/approve',
      { method: 'POST' },
    )
    expect(successSpy).toHaveBeenCalledWith('Grant grant-123 approved.')

    spy.mockRestore()
  })

  it('deny command calls apiFetch with correct deny URL', async () => {
    const httpModule = await import('../src/http')
    const spy = vi.spyOn(httpModule, 'apiFetch').mockResolvedValueOnce({})
    vi.spyOn(httpModule, 'getGrantsEndpoint').mockResolvedValue('http://mock-idp.test/api/grants')

    const { denyCommand } = await import('../src/commands/grants/deny')
    const successSpy = vi.spyOn(consola, 'success')

    await denyCommand.run!({ args: { id: 'grant-456' } } as any)

    expect(spy).toHaveBeenCalledWith(
      'http://mock-idp.test/api/grants/grant-456/deny',
      { method: 'POST' },
    )
    expect(successSpy).toHaveBeenCalledWith('Grant grant-456 denied.')

    spy.mockRestore()
  })
})

// =========================================================================
// delegations command: text formatting
// =========================================================================

describe('delegations command: text formatting', () => {
  const unitHome = join(tmpdir(), `apes-unit-deleg-${process.pid}-${Date.now()}`)

  let logOutput: string[]

  beforeAll(() => {
    mkdirSync(join(unitHome, '.config', 'apes'), { recursive: true })
    writeFileSync(join(unitHome, '.config', 'apes', 'auth.json'), JSON.stringify({
      idp: 'http://mock-idp.test',
      access_token: 'test-token-deleg',
      email: 'user@example.com',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    }, null, 2), { mode: 0o600 })
    process.env.APES_IDP = 'http://mock-idp.test'
  })

  beforeEach(() => {
    logOutput = []
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logOutput.push(args.map(String).join(' '))
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(() => {
    delete process.env.APES_IDP
    rmSync(unitHome, { recursive: true, force: true })
  })

  it('formats non-empty delegation list', async () => {
    const httpModule = await import('../src/http')
    vi.spyOn(httpModule, 'getDelegationsEndpoint').mockResolvedValue('http://mock-idp.test/api/delegations')
    vi.spyOn(httpModule, 'apiFetch').mockResolvedValueOnce([
      {
        id: 'del-1',
        delegator: 'admin@example.com',
        delegate: 'agent@example.com',
        audience: 'api.example.com',
        scopes: ['read', 'write'],
        approval: 'timed',
        expires_at: '2030-01-01',
      },
      {
        id: 'del-2',
        delegator: 'admin@example.com',
        delegate: 'bot@example.com',
        audience: 'api.example.com',
        approval: 'always',
      },
    ])

    const { delegationsCommand } = await import('../src/commands/grants/delegations')
    await delegationsCommand.run!({ args: { json: false } } as any)

    const output = logOutput.join('\n')
    expect(output).toContain('del-1')
    expect(output).toContain('admin@example.com')
    expect(output).toContain('agent@example.com')
    expect(output).toContain('read, write')
    expect(output).toContain('expires 2030-01-01')
    expect(output).toContain('del-2')
    expect(output).toContain('(all)')
  })
})

// =========================================================================
// guides: complete coverage
// =========================================================================

describe('guides data', () => {
  it('all guides have required fields', async () => {
    const { guides } = await import('../src/guides/index')

    expect(guides.length).toBeGreaterThanOrEqual(4)

    for (const guide of guides) {
      expect(guide.id).toBeTruthy()
      expect(guide.title).toBeTruthy()
      expect(guide.description).toBeTruthy()
      expect(guide.steps.length).toBeGreaterThan(0)
    }
  })

  it('each step has either description or note', async () => {
    const { guides } = await import('../src/guides/index')

    for (const guide of guides) {
      for (const step of guide.steps) {
        expect(step.description || step.note).toBeTruthy()
      }
    }
  })
})

// =========================================================================
// http module: apiFetch with non-absolute URL (uses idp)
// =========================================================================

describe('http: apiFetch path resolution', () => {
  beforeAll(() => {
    process.env.APES_IDP = 'http://mock.test'
    const apesDir = join(testHome, '.config', 'apes')
    if (!existsSync(apesDir)) mkdirSync(apesDir, { recursive: true })
    writeFileSync(join(apesDir, 'auth.json'), JSON.stringify({
      idp: 'http://mock.test',
      access_token: 'test-resolve-token',
      email: 'test@example.com',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
    }, null, 2), { mode: 0o600 })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(() => {
    delete process.env.APES_IDP
  })

  it('throws when no IdP and path is relative', async () => {
    const { apiFetch } = await import('../src/http')
    const savedIdp = process.env.APES_IDP
    delete process.env.APES_IDP

    // Also temporarily clear auth
    const authFile = join(testHome, '.config', 'apes', 'auth.json')
    const saved = existsSync(authFile) ? readFileSync(authFile, 'utf-8') : null
    if (saved) rmSync(authFile)

    try {
      await expect(
        apiFetch('/api/something', { token: 'test' }),
      ).rejects.toThrow('No IdP URL configured')
    }
    finally {
      process.env.APES_IDP = savedIdp
      if (saved) writeFileSync(authFile, saved, { mode: 0o600 })
    }
  })
})
