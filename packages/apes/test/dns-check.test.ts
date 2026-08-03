import type { RunningServer } from 'openape-e2e/lifecycle'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { startIdp } from 'openape-e2e/idp-fixture'
import consola from 'consola'

// ---------------------------------------------------------------------------
// Isolate HOME
// ---------------------------------------------------------------------------

const testHome = join(tmpdir(), `apes-dns-${process.pid}-${Date.now()}`)
mkdirSync(testHome, { recursive: true })

vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>()
  return { ...original, homedir: () => testHome }
})

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('dns-check command', () => {
  let server: RunningServer
  let idpBase: string

  let logOutput: string[]
  let stdoutOutput: string[]

  beforeAll(async () => {
    // A real IdP, so OIDC discovery has something to discover.
    server = await startIdp({ managementToken: 'test-token' })
    idpBase = server.url
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
    delete process.env.DDISA_MOCK_RECORDS
  })

  afterAll(async () => {
    await server.stop()
    rmSync(testHome, { recursive: true, force: true })
  })

  it('resolves a domain with mock DDISA records and verifies IdP', async () => {
    const { dnsCheckCommand } = await import('../src/commands/dns-check')

    // Set up DDISA_MOCK_RECORDS to point to our test IdP
    process.env.DDISA_MOCK_RECORDS = JSON.stringify({
      'test.example.com': { idp: idpBase },
    })

    const successSpy = vi.spyOn(consola, 'success')
    vi.spyOn(consola, 'start')

    await dnsCheckCommand.run!({ args: { domain: 'test.example.com' } } as any)

    // Should show the DDISA record
    expect(successSpy).toHaveBeenCalled()
    const successMessages = successSpy.mock.calls.map(c => String(c[0]))
    expect(successMessages.some(m => m.includes(idpBase))).toBe(true)

    // Should show IdP is reachable
    expect(successMessages.some(m => m.includes('reachable'))).toBe(true)

    // Should show discovery info
    const output = logOutput.join('\n')
    expect(output).toContain('IdP URL:')
    expect(output).toContain('Issuer:')
  })

  it('throws CliError when no DDISA record found', async () => {
    const { CliError } = await import('../src/errors')
    const { dnsCheckCommand } = await import('../src/commands/dns-check')

    // Empty mock records — no match for this domain
    process.env.DDISA_MOCK_RECORDS = JSON.stringify({})

    await expect(
      dnsCheckCommand.run!({ args: { domain: 'nonexistent.example.invalid' } } as any),
    ).rejects.toThrow(CliError)
  })

  it('warns when IdP discovery fails', async () => {
    const { dnsCheckCommand } = await import('../src/commands/dns-check')

    // Point DDISA to a non-existent IdP
    process.env.DDISA_MOCK_RECORDS = JSON.stringify({
      'broken.example.com': { idp: 'http://127.0.0.1:1' },
    })

    // This should throw a CliError wrapping the connection error
    await expect(
      dnsCheckCommand.run!({ args: { domain: 'broken.example.com' } } as any),
    ).rejects.toThrow()
  })
})
