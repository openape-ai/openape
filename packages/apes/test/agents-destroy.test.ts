import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/config.js', () => ({
  loadAuth: vi.fn(() => ({ idp: 'https://id.openape.ai', email: 'patrick@hofmann.eco', access_token: 't', expires_at: 9_999_999_999 })),
  getIdpUrl: vi.fn(() => 'https://id.openape.ai'),
}))

vi.mock('../src/http.js', () => ({
  apiFetch: vi.fn(),
}))

const macosUserMock = {
  isDarwin: vi.fn(() => true),
  readMacOSUser: vi.fn(),
  whichBinary: vi.fn((name: string) => `/usr/local/bin/${name}`),
  listMacOSUserNames: vi.fn(() => new Set<string>()),
  isShellRegistered: vi.fn(),
}
vi.mock('../src/lib/macos-user.js', () => macosUserMock)

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    mkdtempSync: vi.fn(() => '/tmp/apes-destroy-test'),
    rmSync: vi.fn(),
    writeFileSync: vi.fn(),
  }
})

const AGENT = {
  email: 'agent-a+patrick+hofmann_eco@id.openape.ai',
  name: 'agent-a',
  owner: 'patrick@hofmann.eco',
  isActive: true,
}

describe('apes agents destroy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    macosUserMock.readMacOSUser.mockReturnValue(null)
    macosUserMock.isDarwin.mockReturnValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('rejects an invalid agent name', async () => {
    const { destroyAgentCommand } = await import('../src/commands/agents/destroy.js')
    await expect((destroyAgentCommand as any).run({
      args: { name: 'BadName', force: true },
    })).rejects.toThrow(/Invalid agent name/)
  })

  it('exits cleanly when neither IdP agent nor OS user exists (idempotency)', async () => {
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(apiFetch).mockResolvedValueOnce([] as any)
    macosUserMock.readMacOSUser.mockReturnValue(null)

    const { destroyAgentCommand } = await import('../src/commands/agents/destroy.js')
    await (destroyAgentCommand as any).run({ args: { name: 'agent-a', force: true } })

    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(apiFetch).toHaveBeenCalledWith('/api/my-agents', { idp: 'https://id.openape.ai' })
  })

  it('hard-deletes the IdP agent when present and OS user is missing', async () => {
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(apiFetch)
      .mockResolvedValueOnce([AGENT] as any)
      .mockResolvedValueOnce({ ok: true } as any)
    macosUserMock.readMacOSUser.mockReturnValue(null)

    const { destroyAgentCommand } = await import('../src/commands/agents/destroy.js')
    await (destroyAgentCommand as any).run({ args: { name: 'agent-a', force: true } })

    expect(apiFetch).toHaveBeenNthCalledWith(2, `/api/my-agents/${encodeURIComponent(AGENT.email)}`, {
      method: 'DELETE',
      idp: 'https://id.openape.ai',
    })
  })

  it('--soft sends PATCH isActive=false instead of DELETE', async () => {
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(apiFetch)
      .mockResolvedValueOnce([AGENT] as any)
      .mockResolvedValueOnce({ ...AGENT, isActive: false } as any)
    macosUserMock.readMacOSUser.mockReturnValue(null)

    const { destroyAgentCommand } = await import('../src/commands/agents/destroy.js')
    await (destroyAgentCommand as any).run({ args: { name: 'agent-a', force: true, soft: true } })

    expect(apiFetch).toHaveBeenNthCalledWith(2, `/api/my-agents/${encodeURIComponent(AGENT.email)}`, {
      method: 'PATCH',
      body: { isActive: false },
      idp: 'https://id.openape.ai',
    })
  })

  it('--keep-os-user skips the privileged escapes call entirely', async () => {
    const { apiFetch } = await import('../src/http.js')
    const { execFileSync } = await import('node:child_process')
    vi.mocked(apiFetch)
      .mockResolvedValueOnce([AGENT] as any)
      .mockResolvedValueOnce({ ok: true } as any)
    macosUserMock.readMacOSUser.mockReturnValue({ name: 'agent-a', uid: 250, shell: '/usr/local/bin/ape-shell' })

    const { destroyAgentCommand } = await import('../src/commands/agents/destroy.js')
    await (destroyAgentCommand as any).run({ args: { name: 'agent-a', force: true, 'keep-os-user': true } })

    expect(execFileSync).not.toHaveBeenCalled()
    expect(apiFetch).toHaveBeenCalledTimes(2)
  })

  it('runs the teardown script via apes run --as root when OS user exists', async () => {
    const { apiFetch } = await import('../src/http.js')
    const { execFileSync } = await import('node:child_process')
    vi.mocked(apiFetch)
      .mockResolvedValueOnce([AGENT] as any)
      .mockResolvedValueOnce({ ok: true } as any)
    macosUserMock.readMacOSUser.mockReturnValue({ name: 'agent-a', uid: 250, shell: '/usr/local/bin/ape-shell' })

    const { destroyAgentCommand } = await import('../src/commands/agents/destroy.js')
    await (destroyAgentCommand as any).run({ args: { name: 'agent-a', force: true } })

    expect(execFileSync).toHaveBeenCalledTimes(1)
    const [bin, argv] = vi.mocked(execFileSync).mock.calls[0]!
    expect(bin).toBe('/usr/local/bin/apes')
    expect(argv).toEqual(['run', '--as', 'root', '--wait', '--', 'bash', '/tmp/apes-destroy-test/teardown.sh'])
  })

  it('issues IdP DELETE before the long-blocking escapes call (token-fresh order)', async () => {
    const { apiFetch } = await import('../src/http.js')
    const { execFileSync } = await import('node:child_process')
    const callOrder: string[] = []
    vi.mocked(apiFetch).mockImplementation(async (path: any, opts?: any) => {
      callOrder.push(`apiFetch:${opts?.method ?? 'GET'}:${path}`)
      if (typeof path === 'string' && path === '/api/my-agents') return [AGENT] as any
      return { ok: true }
    })
    vi.mocked(execFileSync).mockImplementation(((..._args: any[]) => {
      callOrder.push('execFileSync:apes-run-as-root')
      return Buffer.alloc(0)
    }) as any)
    macosUserMock.readMacOSUser.mockReturnValue({ name: 'agent-a', uid: 250, shell: '/usr/local/bin/ape-shell' })

    const { destroyAgentCommand } = await import('../src/commands/agents/destroy.js')
    await (destroyAgentCommand as any).run({ args: { name: 'agent-a', force: true } })

    const deleteIdx = callOrder.findIndex(c => c.includes('DELETE:/api/my-agents/'))
    const escapesIdx = callOrder.findIndex(c => c === 'execFileSync:apes-run-as-root')
    expect(deleteIdx).toBeGreaterThanOrEqual(0)
    expect(escapesIdx).toBeGreaterThan(deleteIdx)
  })
})
