import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/config.js', () => ({
  loadAuth: vi.fn(() => ({ idp: 'https://id.openape.ai', email: 'patrick@hofmann.eco', access_token: 't', expires_at: 9_999_999_999 })),
  getIdpUrl: vi.fn(() => 'https://id.openape.ai'),
}))

vi.mock('../src/http.js', () => ({
  apiFetch: vi.fn(),
}))

// destroy.ts now removes the OS user on Linux via the host platform's
// `runPrivilegedBash` (userdel -r). The single shared `lookupAgentUser`
// mock drives whether an OS user is considered present.
const lookupAgentUser = vi.fn()
const runPrivilegedBash = vi.fn(async () => {})

const hostPlatformMock = {
  isDarwin: vi.fn(() => false),
  isLinux: vi.fn(() => true),
  getHostPlatform: vi.fn(() => ({
    getHostId: () => 'host-id',
    getHostname: () => 'host',
    agentUsername: (n: string) => n,
    lookupAgentUser,
    readAgentUser: () => null,
    listAgentUserNames: () => new Set<string>(),
    listOrphanAgentUsers: () => [],
    installNestSupervisor: vi.fn(async () => {}),
    uninstallNestSupervisor: vi.fn(async () => {}),
    runPrivilegedBash,
    runAsAgentUser: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
  })),
}
vi.mock('../src/lib/host-platform/index.js', () => hostPlatformMock)

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
    lookupAgentUser.mockReturnValue(null)
    runPrivilegedBash.mockResolvedValue(undefined)
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
    lookupAgentUser.mockReturnValue(null)

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
    lookupAgentUser.mockReturnValue(null)

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
    lookupAgentUser.mockReturnValue(null)

    const { destroyAgentCommand } = await import('../src/commands/agents/destroy.js')
    await (destroyAgentCommand as any).run({ args: { name: 'agent-a', force: true, soft: true } })

    expect(apiFetch).toHaveBeenNthCalledWith(2, `/api/my-agents/${encodeURIComponent(AGENT.email)}`, {
      method: 'PATCH',
      body: { isActive: false },
      idp: 'https://id.openape.ai',
    })
  })

  it('refuses with a clear hint when no TTY and --force was not passed (was: opaque uv_tty_init crash)', async () => {
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(apiFetch).mockResolvedValueOnce([AGENT] as any)
    lookupAgentUser.mockReturnValue(null)

    // Force a non-TTY stdin for the duration of this test. Vitest spawns
    // workers without a controlling terminal, so isTTY is already false,
    // but we set it explicitly so the assertion stays valid even if a
    // future test runner attaches one.
    const originalIsTTY = process.stdin.isTTY
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })
    try {
      const { destroyAgentCommand } = await import('../src/commands/agents/destroy.js')
      await expect((destroyAgentCommand as any).run({
        args: { name: 'agent-a' },
      })).rejects.toThrow(/No TTY available.*--force/)
    }
    finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true })
    }
  })

  it('--keep-os-user skips the privileged userdel call entirely', async () => {
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(apiFetch)
      .mockResolvedValueOnce([AGENT] as any)
      .mockResolvedValueOnce({ ok: true } as any)
    lookupAgentUser.mockReturnValue({ name: 'agent-a', uid: 250, shell: '/usr/local/bin/ape-shell', homeDir: '/home/agent-a' })

    const { destroyAgentCommand } = await import('../src/commands/agents/destroy.js')
    await (destroyAgentCommand as any).run({ args: { name: 'agent-a', force: true, 'keep-os-user': true } })

    expect(runPrivilegedBash).not.toHaveBeenCalled()
    expect(apiFetch).toHaveBeenCalledTimes(2)
  })

  it('removes the OS user via userdel -r when the user exists', async () => {
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(apiFetch)
      .mockResolvedValueOnce([AGENT] as any)
      .mockResolvedValueOnce({ ok: true } as any)
    lookupAgentUser.mockReturnValue({ name: 'agent-a', uid: 250, shell: '/usr/local/bin/ape-shell', homeDir: '/home/agent-a' })

    const { destroyAgentCommand } = await import('../src/commands/agents/destroy.js')
    await (destroyAgentCommand as any).run({ args: { name: 'agent-a', force: true } })

    expect(runPrivilegedBash).toHaveBeenCalledTimes(1)
    const script = runPrivilegedBash.mock.calls[0]![0] as string
    expect(script).toContain('userdel -r')
    expect(script).toContain('"agent-a"')
  })

  it('issues IdP DELETE before the privileged OS-user removal (token-fresh order)', async () => {
    const { apiFetch } = await import('../src/http.js')
    const callOrder: string[] = []
    vi.mocked(apiFetch).mockImplementation(async (path: any, opts?: any) => {
      callOrder.push(`apiFetch:${opts?.method ?? 'GET'}:${path}`)
      if (typeof path === 'string' && path === '/api/my-agents') return [AGENT] as any
      return { ok: true }
    })
    runPrivilegedBash.mockImplementation(async () => {
      callOrder.push('runPrivilegedBash:userdel')
    })
    lookupAgentUser.mockReturnValue({ name: 'agent-a', uid: 250, shell: '/usr/local/bin/ape-shell', homeDir: '/home/agent-a' })

    const { destroyAgentCommand } = await import('../src/commands/agents/destroy.js')
    await (destroyAgentCommand as any).run({ args: { name: 'agent-a', force: true } })

    const deleteIdx = callOrder.findIndex(c => c.includes('DELETE:/api/my-agents/'))
    const userdelIdx = callOrder.findIndex(c => c === 'runPrivilegedBash:userdel')
    expect(deleteIdx).toBeGreaterThanOrEqual(0)
    expect(userdelIdx).toBeGreaterThan(deleteIdx)
  })
})
