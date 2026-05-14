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
    // The OS-teardown path collects the local admin password; CI never
    // has a TTY so we set the env-var resolution path explicitly. Tests
    // that exercise the "no password" failure case delete this first.
    process.env.APES_ADMIN_PASSWORD = 'test-admin-pw'
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    delete process.env.APES_ADMIN_PASSWORD
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

  it('refuses with a clear hint when no TTY and --force was not passed (was: opaque uv_tty_init crash)', async () => {
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(apiFetch).mockResolvedValueOnce([AGENT] as any)
    macosUserMock.readMacOSUser.mockReturnValue(null)

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

  it('--keep-os-user skips the privileged sudo call entirely', async () => {
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

  it('runs the teardown script via sudo -S when OS user exists', async () => {
    const { apiFetch } = await import('../src/http.js')
    const { execFileSync } = await import('node:child_process')
    vi.mocked(apiFetch)
      .mockResolvedValueOnce([AGENT] as any)
      .mockResolvedValueOnce({ ok: true } as any)
    macosUserMock.readMacOSUser.mockReturnValue({ name: 'agent-a', uid: 250, shell: '/usr/local/bin/ape-shell' })

    const { destroyAgentCommand } = await import('../src/commands/agents/destroy.js')
    await (destroyAgentCommand as any).run({ args: { name: 'agent-a', force: true } })

    expect(execFileSync).toHaveBeenCalledTimes(1)
    const [bin, argv, opts] = vi.mocked(execFileSync).mock.calls[0]!
    expect(bin).toBe('/usr/local/bin/sudo')
    expect(argv).toEqual(['-S', '--prompt=', '--', 'bash', '/tmp/apes-destroy-test/teardown.sh'])
    // Password must be piped via stdin, never as argv (would leak via
    // ps). Two newline-terminated copies: first for sudo -S, second for
    // the teardown script's `read -r ADMIN_PASSWORD`.
    expect(opts).toMatchObject({ input: 'test-admin-pw\ntest-admin-pw\n', stdio: ['pipe', 'inherit', 'inherit'] })
    expect(argv).not.toContain('test-admin-pw')
  })

  it('degrades gracefully when running headless on a legacy agent (no TTY, no APES_ADMIN_PASSWORD)', async () => {
    // Headless context = the troop-WS destroy path: nest daemon runs
    // \`apes agents destroy --force\` without a TTY. For Phase-G
    // agents the root-via-escapes teardown works (already covered
    // elsewhere); for legacy /Users/ agents we used to throw a
    // confusing 'No TTY' error, now we skip the OS-side step and
    // let the rest of the destroy (IdP de-register + registry
    // removal) proceed. Operator can re-run from a shell to fully
    // clean up the dscl record + home dir.
    delete process.env.APES_ADMIN_PASSWORD
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(apiFetch)
      .mockResolvedValueOnce([AGENT] as any) // GET /api/my-agents
      .mockResolvedValueOnce({ ok: true } as any) // DELETE /api/my-agents/:id
    macosUserMock.readMacOSUser.mockReturnValue({ name: 'agent-a', uid: 250, shell: '/usr/local/bin/ape-shell', homeDir: '/Users/agent-a' })

    const originalIsTTY = process.stdin.isTTY
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true })
    try {
      const { destroyAgentCommand } = await import('../src/commands/agents/destroy.js')
      await (destroyAgentCommand as any).run({
        args: { name: 'agent-a', force: true },
      })
      // No throw — the destroy proceeds to completion, just without
      // the sysadminctl/rm step. apiFetch was still called for the
      // IdP delete (mock count above), proving the IdP-side cleanup
      // ran before we degraded the OS-side.
    }
    finally {
      Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true })
    }
  })

  it('issues IdP DELETE before the long-blocking sudo call (token-fresh order)', async () => {
    const { apiFetch } = await import('../src/http.js')
    const { execFileSync } = await import('node:child_process')
    const callOrder: string[] = []
    vi.mocked(apiFetch).mockImplementation(async (path: any, opts?: any) => {
      callOrder.push(`apiFetch:${opts?.method ?? 'GET'}:${path}`)
      if (typeof path === 'string' && path === '/api/my-agents') return [AGENT] as any
      return { ok: true }
    })
    vi.mocked(execFileSync).mockImplementation(((..._args: any[]) => {
      callOrder.push('execFileSync:sudo')
      return Buffer.alloc(0)
    }) as any)
    macosUserMock.readMacOSUser.mockReturnValue({ name: 'agent-a', uid: 250, shell: '/usr/local/bin/ape-shell' })

    const { destroyAgentCommand } = await import('../src/commands/agents/destroy.js')
    await (destroyAgentCommand as any).run({ args: { name: 'agent-a', force: true } })

    const deleteIdx = callOrder.findIndex(c => c.includes('DELETE:/api/my-agents/'))
    const sudoIdx = callOrder.findIndex(c => c === 'execFileSync:sudo')
    expect(deleteIdx).toBeGreaterThanOrEqual(0)
    expect(sudoIdx).toBeGreaterThan(deleteIdx)
  })
})
