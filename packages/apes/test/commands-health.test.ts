import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Pure unit test of the `apes health` diagnostic command. We mock every
// dependency so the test runs without touching the network, filesystem,
// or the auth cache on disk.

vi.mock('../src/config.js', () => ({
  CONFIG_DIR: '/tmp/fake-config',
  AUTH_FILE: '/tmp/fake-config/auth.json',
  loadAuth: vi.fn(),
  loadConfig: vi.fn(() => ({})),
  getIdpUrl: vi.fn(() => 'https://idp.test'),
}))
vi.mock('../src/http.js', () => ({
  apiFetch: vi.fn(),
  getGrantsEndpoint: vi.fn(async () => 'https://idp.test/api/grants'),
}))

function validAuth() {
  return {
    idp: 'https://idp.test',
    access_token: 'tok',
    email: 'alice@example.com',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  }
}

describe('runHealth', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    logSpy.mockRestore()
  })

  it('prints a human-readable report on the happy path', async () => {
    const { loadAuth } = await import('../src/config.js')
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(loadAuth).mockReturnValue(validAuth() as any)
    vi.mocked(apiFetch).mockResolvedValue({ data: [{}, {}, {}] } as any)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true }) as any))

    const { runHealth } = await import('../src/commands/health.js')
    await expect(runHealth({ json: false })).resolves.toBeUndefined()

    const output = logSpy.mock.calls.map(c => String(c[0])).join('\n')
    expect(output).toMatch(/apes \d+\.\d+/)
    expect(output).toContain('alice@example.com')
    expect(output).toMatch(/IdP: reachable/)
    expect(output).toMatch(/Grants: 3/)
  })

  it('emits a JSON report when --json is set', async () => {
    const { loadAuth } = await import('../src/config.js')
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(loadAuth).mockReturnValue(validAuth() as any)
    vi.mocked(apiFetch).mockResolvedValue({ data: [{}, {}, {}] } as any)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true }) as any))

    const { runHealth } = await import('../src/commands/health.js')
    await runHealth({ json: true })

    expect(logSpy).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(String(logSpy.mock.calls[0]![0]))
    expect(payload.ok).toBe(true)
    expect(payload.auth.present).toBe(true)
    expect(payload.auth.type).toBe('human')
    expect(payload.grants.count).toBe(3)
  })

  it('throws CliError exit 1 when not logged in', async () => {
    const { loadAuth } = await import('../src/config.js')
    vi.mocked(loadAuth).mockReturnValue(null)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true }) as any))

    const { runHealth } = await import('../src/commands/health.js')
    const { CliError } = await import('../src/errors.js')
    await expect(runHealth({ json: false })).rejects.toMatchObject({
      exitCode: 1,
      message: expect.stringContaining('Not logged in'),
    })
    // And it's the right error class
    await expect(runHealth({ json: false })).rejects.toBeInstanceOf(CliError)
  })

  it('throws CliError exit 1 when the token is expired', async () => {
    const { loadAuth } = await import('../src/config.js')
    vi.mocked(loadAuth).mockReturnValue({
      ...validAuth(),
      expires_at: Math.floor(Date.now() / 1000) - 3600,
    } as any)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true }) as any))

    const { runHealth } = await import('../src/commands/health.js')
    await expect(runHealth({ json: false })).rejects.toMatchObject({
      exitCode: 1,
      message: expect.stringMatching(/expired/i),
    })
  })

  it('throws CliError exit 1 when the IdP is unreachable', async () => {
    const { loadAuth } = await import('../src/config.js')
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(loadAuth).mockReturnValue(validAuth() as any)
    // Grants fetch may or may not run; make it safe either way.
    vi.mocked(apiFetch).mockResolvedValue({ data: [] } as any)
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('connect ECONNREFUSED')
    }))

    const { runHealth } = await import('../src/commands/health.js')
    await expect(runHealth({ json: false })).rejects.toMatchObject({
      exitCode: 1,
      message: expect.stringMatching(/IdP.*unreachable/),
    })
  })

  it('does not fail when grants lookup fails but IdP is reachable', async () => {
    const { loadAuth } = await import('../src/config.js')
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(loadAuth).mockReturnValue(validAuth() as any)
    vi.mocked(apiFetch).mockRejectedValue(new Error('boom'))
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true }) as any))

    const { runHealth } = await import('../src/commands/health.js')
    await expect(runHealth({ json: false })).resolves.toBeUndefined()

    const output = logSpy.mock.calls.map(c => String(c[0])).join('\n')
    expect(output).toMatch(/Grants: <unreachable/)
  })

  it('labels an agent identity', async () => {
    const { loadAuth } = await import('../src/config.js')
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(loadAuth).mockReturnValue({
      ...validAuth(),
      email: 'agent+alice@id.openape.at',
    } as any)
    vi.mocked(apiFetch).mockResolvedValue({ data: [] } as any)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true }) as any))

    const { runHealth } = await import('../src/commands/health.js')
    await runHealth({ json: false })
    const output = logSpy.mock.calls.map(c => String(c[0])).join('\n')
    expect(output).toContain('(agent)')
  })
})
