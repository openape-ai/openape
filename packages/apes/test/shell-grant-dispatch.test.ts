import consola from 'consola'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// We mock every dependency of the grant-dispatch module so tests run
// without touching the network, filesystem, or auth state. The goal is to
// verify the flow control logic: adapter path vs session path, reuse vs
// request, approval vs denial — not the actual IdP integration (that's
// covered in commands.test.ts via the in-process IdP).

vi.mock('../src/config.js', () => ({
  loadAuth: vi.fn(),
}))
vi.mock('../src/http.js', () => ({
  apiFetch: vi.fn(),
  getGrantsEndpoint: vi.fn(async () => 'http://idp.test/api/grants'),
}))
vi.mock('../src/shapes/index.js', () => ({
  createShapesGrant: vi.fn(),
  fetchGrantToken: vi.fn(),
  findExistingGrant: vi.fn(),
  loadOrInstallAdapter: vi.fn(),
  parseShellCommand: vi.fn(),
  resolveCommand: vi.fn(),
  verifyAndConsume: vi.fn(),
  waitForGrantStatus: vi.fn(),
}))
vi.mock('../src/notifications.js', () => ({
  notifyGrantPending: vi.fn(),
}))

const fakeAuth = { email: 'alice@example.com', idp: 'http://idp.test' }

describe('requestGrantForShellLine', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.clearAllMocks()
    const { loadAuth } = await import('../src/config.js')
    vi.mocked(loadAuth).mockReturnValue(fakeAuth as any)
    infoSpy = vi.spyOn(consola, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    infoSpy.mockRestore()
    delete process.env.APES_QUIET_GRANT_REUSE
    vi.resetModules()
  })

  it('returns denied when not logged in', async () => {
    const { loadAuth } = await import('../src/config.js')
    vi.mocked(loadAuth).mockReturnValue(null)

    const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
    const result = await requestGrantForShellLine('ls', { targetHost: 'host.test' })

    expect(result).toEqual({ kind: 'denied', reason: expect.stringContaining('Not logged in') })
  })

  it('rejects `sudo <cmd>` with a hint to use `apes run --as root -- <cmd>`', async () => {
    const { parseShellCommand, loadOrInstallAdapter } = await import('../src/shapes/index.js')
    vi.mocked(parseShellCommand).mockReturnValue({ executable: 'sudo', argv: ['apt', 'install', 'ffmpeg'], isCompound: false, raw: 'sudo apt install ffmpeg' })

    const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
    const result = await requestGrantForShellLine('sudo apt install ffmpeg', { targetHost: 'host.test' })

    expect(result).toEqual({
      kind: 'denied',
      reason: expect.stringContaining('apes run --as root -- apt install ffmpeg'),
    })
    // Must short-circuit before any adapter work.
    expect(loadOrInstallAdapter).not.toHaveBeenCalled()
  })

  it('rejects bare `sudo` with a generic hint', async () => {
    const { parseShellCommand } = await import('../src/shapes/index.js')
    vi.mocked(parseShellCommand).mockReturnValue({ executable: 'sudo', argv: [], isCompound: false, raw: 'sudo' })

    const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
    const result = await requestGrantForShellLine('sudo', { targetHost: 'host.test' })

    expect(result).toEqual({
      kind: 'denied',
      reason: expect.stringContaining('apes run --as root -- <cmd>'),
    })
  })

  it('does not short-circuit `sudo` when the leading token is not sudo', async () => {
    // We only short-circuit the simple leading-`sudo` case which is the
    // agent footgun we care about. Compound lines and lines where sudo
    // appears later fall through to the generic session-grant path so
    // the REPL can still negotiate a grant and bash surfaces the real
    // error. Set up a minimal session-grant mock chain and assert the
    // result is approved via the session path, not denied with our sudo
    // message.
    const { parseShellCommand } = await import('../src/shapes/index.js')
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(parseShellCommand).mockReturnValue({ executable: 'echo', argv: ['foo', '|', 'sudo', 'tee'], isCompound: true, raw: 'echo foo | sudo tee /etc/x' })
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({ data: [] } as any)
      .mockResolvedValueOnce({ id: 'fallthrough-grant', status: 'pending' } as any)
      .mockResolvedValueOnce({ status: 'approved' } as any)

    const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
    const result = await requestGrantForShellLine('echo foo | sudo tee /etc/x', { targetHost: 'host.test' })

    expect(result).toEqual({ kind: 'approved', grantId: 'fallthrough-grant', mode: 'session' })
  })

  it('reuses an existing adapter grant when findExistingGrant returns one', async () => {
    const { parseShellCommand, loadOrInstallAdapter, resolveCommand, findExistingGrant, fetchGrantToken, verifyAndConsume, createShapesGrant } = await import('../src/shapes/index.js')
    vi.mocked(parseShellCommand).mockReturnValue({ executable: 'ls', argv: ['-la'], isCompound: false, raw: 'ls -la' })
    vi.mocked(loadOrInstallAdapter).mockResolvedValue({ adapter: { cli: { id: 'ls', executable: 'ls', audience: 'shapes' }, operations: [] }, source: '/tmp/ls.toml', digest: 'sha' } as any)
    vi.mocked(resolveCommand).mockResolvedValue({ detail: { display: 'ls -la' } } as any)
    vi.mocked(findExistingGrant).mockResolvedValue('reused-grant-id')
    vi.mocked(fetchGrantToken).mockResolvedValue('token123')
    vi.mocked(verifyAndConsume).mockResolvedValue(undefined)

    const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
    const result = await requestGrantForShellLine('ls -la', { targetHost: 'host.test' })

    expect(result).toEqual({ kind: 'approved', grantId: 'reused-grant-id', mode: 'adapter' })
    expect(createShapesGrant).not.toHaveBeenCalled()
    expect(verifyAndConsume).toHaveBeenCalledWith('token123', expect.anything())
  })

  it('requests a new adapter grant when no existing one matches', async () => {
    const { parseShellCommand, loadOrInstallAdapter, resolveCommand, findExistingGrant, createShapesGrant, waitForGrantStatus, fetchGrantToken, verifyAndConsume } = await import('../src/shapes/index.js')
    vi.mocked(parseShellCommand).mockReturnValue({ executable: 'curl', argv: ['https://example.com'], isCompound: false, raw: 'curl https://example.com' })
    vi.mocked(loadOrInstallAdapter).mockResolvedValue({ adapter: { cli: { id: 'curl', executable: 'curl', audience: 'shapes' }, operations: [] }, source: '/tmp/curl.toml', digest: 'sha' } as any)
    vi.mocked(resolveCommand).mockResolvedValue({ detail: { display: 'curl https://example.com' } } as any)
    vi.mocked(findExistingGrant).mockResolvedValue(null)
    vi.mocked(createShapesGrant).mockResolvedValue({ id: 'new-grant-id', status: 'pending' } as any)
    vi.mocked(waitForGrantStatus).mockResolvedValue('approved')
    vi.mocked(fetchGrantToken).mockResolvedValue('token456')
    vi.mocked(verifyAndConsume).mockResolvedValue(undefined)

    const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
    const result = await requestGrantForShellLine('curl https://example.com', { targetHost: 'host.test' })

    expect(result).toEqual({ kind: 'approved', grantId: 'new-grant-id', mode: 'adapter' })
    expect(createShapesGrant).toHaveBeenCalled()
    expect(verifyAndConsume).toHaveBeenCalledWith('token456', expect.anything())
  })

  it('returns denied when the adapter grant request is denied', async () => {
    const { parseShellCommand, loadOrInstallAdapter, resolveCommand, findExistingGrant, createShapesGrant, waitForGrantStatus } = await import('../src/shapes/index.js')
    vi.mocked(parseShellCommand).mockReturnValue({ executable: 'rm', argv: ['-rf', '/'], isCompound: false, raw: 'rm -rf /' })
    vi.mocked(loadOrInstallAdapter).mockResolvedValue({ adapter: { cli: { id: 'rm', executable: 'rm', audience: 'shapes' }, operations: [] }, source: '/tmp/rm.toml', digest: 'sha' } as any)
    vi.mocked(resolveCommand).mockResolvedValue({ detail: { display: 'rm -rf /' } } as any)
    vi.mocked(findExistingGrant).mockResolvedValue(null)
    vi.mocked(createShapesGrant).mockResolvedValue({ id: 'scary-grant-id', status: 'pending' } as any)
    vi.mocked(waitForGrantStatus).mockResolvedValue('denied')

    const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
    const result = await requestGrantForShellLine('rm -rf /', { targetHost: 'host.test' })

    expect(result.kind).toBe('denied')
    if (result.kind === 'denied') {
      expect(result.reason).toContain('denied')
    }
  })

  it('falls back to a session grant when the command is compound', async () => {
    const { parseShellCommand, loadOrInstallAdapter } = await import('../src/shapes/index.js')
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(parseShellCommand).mockReturnValue({ executable: 'ls', argv: ['|'], isCompound: true, raw: 'ls | grep foo' })

    // apiFetch is called twice: once to list existing grants (none match),
    // once to create a new one, and once more to poll status.
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({ data: [] } as any) // list grants
      .mockResolvedValueOnce({ id: 'session-grant-id', status: 'pending' } as any) // create
      .mockResolvedValueOnce({ status: 'approved' } as any) // poll

    const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
    const result = await requestGrantForShellLine('ls | grep foo', { targetHost: 'host.test' })

    expect(result).toEqual({ kind: 'approved', grantId: 'session-grant-id', mode: 'session' })
    // Adapter path should never have been attempted past parseShellCommand
    expect(loadOrInstallAdapter).not.toHaveBeenCalled()
  })

  it('reuses an existing timed session grant when one is found', async () => {
    const { parseShellCommand, loadOrInstallAdapter } = await import('../src/shapes/index.js')
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(parseShellCommand).mockReturnValue({ executable: 'ls', argv: ['|'], isCompound: true, raw: 'ls | grep foo' })

    vi.mocked(apiFetch).mockResolvedValueOnce({
      data: [
        {
          id: 'existing-session',
          status: 'approved',
          request: { audience: 'ape-shell', target_host: 'host.test', grant_type: 'timed' },
        },
      ],
    } as any)

    const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
    const result = await requestGrantForShellLine('ls | grep foo', { targetHost: 'host.test' })

    expect(result).toEqual({ kind: 'approved', grantId: 'existing-session', mode: 'session' })
    expect(loadOrInstallAdapter).not.toHaveBeenCalled()
  })

  it('falls back to session grant when no adapter is found for the binary', async () => {
    const { parseShellCommand, loadOrInstallAdapter } = await import('../src/shapes/index.js')
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(parseShellCommand).mockReturnValue({ executable: 'obscure-tool', argv: ['--foo'], isCompound: false, raw: 'obscure-tool --foo' })
    vi.mocked(loadOrInstallAdapter).mockResolvedValue(null)

    vi.mocked(apiFetch)
      .mockResolvedValueOnce({ data: [] } as any)
      .mockResolvedValueOnce({ id: 'fallback-grant', status: 'pending' } as any)
      .mockResolvedValueOnce({ status: 'approved' } as any)

    const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
    const result = await requestGrantForShellLine('obscure-tool --foo', { targetHost: 'host.test' })

    expect(result).toEqual({ kind: 'approved', grantId: 'fallback-grant', mode: 'session' })
  })

  it('logs a reuse line when a session grant cache hit occurs', async () => {
    const { parseShellCommand } = await import('../src/shapes/index.js')
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(parseShellCommand).mockReturnValue({ executable: 'ls', argv: ['|'], isCompound: true, raw: 'ls | grep foo' })

    vi.mocked(apiFetch).mockResolvedValueOnce({
      data: [
        {
          id: 'existing-session',
          status: 'approved',
          request: { audience: 'ape-shell', target_host: 'host.test', grant_type: 'timed' },
        },
      ],
    } as any)

    const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
    await requestGrantForShellLine('ls | grep foo', { targetHost: 'host.test' })

    const reuseCall = infoSpy.mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('Reusing') && call[0].includes('existing-session'),
    )
    expect(reuseCall).toBeDefined()
  })

  it('suppresses session grant reuse line when APES_QUIET_GRANT_REUSE=1', async () => {
    process.env.APES_QUIET_GRANT_REUSE = '1'
    try {
      const { parseShellCommand } = await import('../src/shapes/index.js')
      const { apiFetch } = await import('../src/http.js')
      vi.mocked(parseShellCommand).mockReturnValue({ executable: 'ls', argv: ['|'], isCompound: true, raw: 'ls | grep foo' })

      vi.mocked(apiFetch).mockResolvedValueOnce({
        data: [
          {
            id: 'existing-session',
            status: 'approved',
            request: { audience: 'ape-shell', target_host: 'host.test', grant_type: 'timed' },
          },
        ],
      } as any)

      const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
      await requestGrantForShellLine('ls | grep foo', { targetHost: 'host.test' })

      const reuseCall = infoSpy.mock.calls.find(call =>
        typeof call[0] === 'string' && call[0].includes('Reusing'),
      )
      expect(reuseCall).toBeUndefined()
    }
    finally {
      delete process.env.APES_QUIET_GRANT_REUSE
    }
  })

  it('suppresses adapter grant reuse line when APES_QUIET_GRANT_REUSE=1', async () => {
    process.env.APES_QUIET_GRANT_REUSE = '1'
    try {
      const { parseShellCommand, loadOrInstallAdapter, resolveCommand, findExistingGrant, fetchGrantToken, verifyAndConsume } = await import('../src/shapes/index.js')
      vi.mocked(parseShellCommand).mockReturnValue({ executable: 'ls', argv: ['-la'], isCompound: false, raw: 'ls -la' })
      vi.mocked(loadOrInstallAdapter).mockResolvedValue({ adapter: { cli: { id: 'ls', executable: 'ls', audience: 'shapes' }, operations: [] }, source: '/tmp/ls.toml', digest: 'sha' } as any)
      vi.mocked(resolveCommand).mockResolvedValue({ detail: { display: 'ls -la' } } as any)
      vi.mocked(findExistingGrant).mockResolvedValue('reused-grant-id')
      vi.mocked(fetchGrantToken).mockResolvedValue('token123')
      vi.mocked(verifyAndConsume).mockResolvedValue(undefined)

      const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
      await requestGrantForShellLine('ls -la', { targetHost: 'host.test' })

      const reuseCall = infoSpy.mock.calls.find(call =>
        typeof call[0] === 'string' && call[0].includes('Reusing'),
      )
      expect(reuseCall).toBeUndefined()
    }
    finally {
      delete process.env.APES_QUIET_GRANT_REUSE
    }
  })

  it('logs an approval ack line after session grant poll resolves approved', async () => {
    const { parseShellCommand } = await import('../src/shapes/index.js')
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(parseShellCommand).mockReturnValue({ executable: 'ls', argv: ['|'], isCompound: true, raw: 'ls | grep foo' })

    vi.mocked(apiFetch)
      .mockResolvedValueOnce({ data: [] } as any) // list grants
      .mockResolvedValueOnce({ id: 'session-grant-id', status: 'pending' } as any) // create
      .mockResolvedValueOnce({ status: 'approved' } as any) // poll

    const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
    await requestGrantForShellLine('ls | grep foo', { targetHost: 'host.test' })

    const requestingCall = infoSpy.mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('Requesting ape-shell session grant'),
    )
    expect(requestingCall).toBeDefined()

    const approvalCall = infoSpy.mock.calls.find(call =>
      typeof call[0] === 'string' && /Grant .* approved/.test(call[0]),
    )
    expect(approvalCall).toBeDefined()
  })

  it('logs an approval ack line after adapter grant waitForGrantStatus resolves approved', async () => {
    const { parseShellCommand, loadOrInstallAdapter, resolveCommand, findExistingGrant, createShapesGrant, waitForGrantStatus, fetchGrantToken, verifyAndConsume } = await import('../src/shapes/index.js')
    vi.mocked(parseShellCommand).mockReturnValue({ executable: 'curl', argv: ['https://example.com'], isCompound: false, raw: 'curl https://example.com' })
    vi.mocked(loadOrInstallAdapter).mockResolvedValue({ adapter: { cli: { id: 'curl', executable: 'curl', audience: 'shapes' }, operations: [] }, source: '/tmp/curl.toml', digest: 'sha' } as any)
    vi.mocked(resolveCommand).mockResolvedValue({ detail: { display: 'curl https://example.com' } } as any)
    vi.mocked(findExistingGrant).mockResolvedValue(null)
    vi.mocked(createShapesGrant).mockResolvedValue({ id: 'new-grant-id', status: 'pending' } as any)
    vi.mocked(waitForGrantStatus).mockResolvedValue('approved')
    vi.mocked(fetchGrantToken).mockResolvedValue('token456')
    vi.mocked(verifyAndConsume).mockResolvedValue(undefined)

    const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
    await requestGrantForShellLine('curl https://example.com', { targetHost: 'host.test' })

    const approvalCall = infoSpy.mock.calls.find(call =>
      typeof call[0] === 'string' && /Grant .* approved/.test(call[0]),
    )
    expect(approvalCall).toBeDefined()
  })

  it('does not log an approval ack line when adapter grant is denied', async () => {
    const { parseShellCommand, loadOrInstallAdapter, resolveCommand, findExistingGrant, createShapesGrant, waitForGrantStatus } = await import('../src/shapes/index.js')
    vi.mocked(parseShellCommand).mockReturnValue({ executable: 'rm', argv: ['-rf', '/'], isCompound: false, raw: 'rm -rf /' })
    vi.mocked(loadOrInstallAdapter).mockResolvedValue({ adapter: { cli: { id: 'rm', executable: 'rm', audience: 'shapes' }, operations: [] }, source: '/tmp/rm.toml', digest: 'sha' } as any)
    vi.mocked(resolveCommand).mockResolvedValue({ detail: { display: 'rm -rf /' } } as any)
    vi.mocked(findExistingGrant).mockResolvedValue(null)
    vi.mocked(createShapesGrant).mockResolvedValue({ id: 'scary-grant-id', status: 'pending' } as any)
    vi.mocked(waitForGrantStatus).mockResolvedValue('denied')

    const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
    await requestGrantForShellLine('rm -rf /', { targetHost: 'host.test' })

    const approvalCall = infoSpy.mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('approved — continuing'),
    )
    expect(approvalCall).toBeUndefined()
  })

  it('does not log an approval ack line on session grant cache hit', async () => {
    const { parseShellCommand } = await import('../src/shapes/index.js')
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(parseShellCommand).mockReturnValue({ executable: 'ls', argv: ['|'], isCompound: true, raw: 'ls | grep foo' })

    vi.mocked(apiFetch).mockResolvedValueOnce({
      data: [
        {
          id: 'existing-session',
          status: 'approved',
          request: { audience: 'ape-shell', target_host: 'host.test', grant_type: 'timed' },
        },
      ],
    } as any)

    const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
    await requestGrantForShellLine('ls | grep foo', { targetHost: 'host.test' })

    const reuseCall = infoSpy.mock.calls.find(call =>
      typeof call[0] === 'string' && /Reusing/.test(call[0]),
    )
    expect(reuseCall).toBeDefined()

    const approvalCall = infoSpy.mock.calls.find(call =>
      typeof call[0] === 'string' && call[0].includes('approved — continuing'),
    )
    expect(approvalCall).toBeUndefined()
  })

  it('still logs fresh session grant request line when APES_QUIET_GRANT_REUSE=1', async () => {
    process.env.APES_QUIET_GRANT_REUSE = '1'
    try {
      const { parseShellCommand } = await import('../src/shapes/index.js')
      const { apiFetch } = await import('../src/http.js')
      vi.mocked(parseShellCommand).mockReturnValue({ executable: 'ls', argv: ['|'], isCompound: true, raw: 'ls | grep foo' })

      vi.mocked(apiFetch)
        .mockResolvedValueOnce({ data: [] } as any) // no existing grant
        .mockResolvedValueOnce({ id: 'new-session', status: 'pending' } as any) // create
        .mockResolvedValueOnce({ status: 'approved' } as any) // poll

      const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
      await requestGrantForShellLine('ls | grep foo', { targetHost: 'host.test' })

      const requestCall = infoSpy.mock.calls.find(call =>
        typeof call[0] === 'string' && call[0].includes('Requesting ape-shell session grant'),
      )
      expect(requestCall).toBeDefined()
    }
    finally {
      delete process.env.APES_QUIET_GRANT_REUSE
    }
  })

  // ─────────────────────────────────────────────────────────────────────
  // apes self-dispatch shortcut — exempts `apes <subcmd>` invocations
  // from inside the REPL from the grant flow, except for run/fetch/mcp.
  // Fixes the `apes grants run <id>` recursion under 0.9.0 async default.
  // ─────────────────────────────────────────────────────────────────────

  describe('apes self-dispatch shortcut', () => {
    it('exempts `apes whoami` — introspection, not a new user action', async () => {
      const { parseShellCommand, loadOrInstallAdapter } = await import('../src/shapes/index.js')
      const { apiFetch } = await import('../src/http.js')
      vi.mocked(parseShellCommand).mockReturnValue({ executable: 'apes', argv: ['whoami'], isCompound: false, raw: 'apes whoami' })

      const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
      const result = await requestGrantForShellLine('apes whoami', { targetHost: 'host.test' })

      expect(result).toEqual({ kind: 'approved', grantId: 'shell-internal', mode: 'self' })
      // Critical: the adapter + session paths must NOT be reached
      expect(loadOrInstallAdapter).not.toHaveBeenCalled()
      expect(apiFetch).not.toHaveBeenCalled()
    })

    it('exempts `apes grants run <id>` — the async-flow bootstrap case', async () => {
      const { parseShellCommand, loadOrInstallAdapter } = await import('../src/shapes/index.js')
      const { apiFetch } = await import('../src/http.js')
      vi.mocked(parseShellCommand).mockReturnValue({
        executable: 'apes',
        argv: ['grants', 'run', 'e887a7e3-6f8c-4503-bb50-18f47585deb8'],
        isCompound: false,
        raw: 'apes grants run e887a7e3-6f8c-4503-bb50-18f47585deb8',
      })

      const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
      const result = await requestGrantForShellLine('apes grants run e887a7e3-6f8c-4503-bb50-18f47585deb8', { targetHost: 'host.test' })

      expect(result).toEqual({ kind: 'approved', grantId: 'shell-internal', mode: 'self' })
      expect(loadOrInstallAdapter).not.toHaveBeenCalled()
      expect(apiFetch).not.toHaveBeenCalled()
    })

    it('exempts `apes grants list`', async () => {
      const { parseShellCommand, loadOrInstallAdapter } = await import('../src/shapes/index.js')
      vi.mocked(parseShellCommand).mockReturnValue({ executable: 'apes', argv: ['grants', 'list'], isCompound: false, raw: 'apes grants list' })

      const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
      const result = await requestGrantForShellLine('apes grants list', { targetHost: 'host.test' })

      expect(result.kind).toBe('approved')
      if (result.kind === 'approved')
        expect(result.mode).toBe('self')
      expect(loadOrInstallAdapter).not.toHaveBeenCalled()
    })

    it('exempts `apes adapter install curl` — parallels the auto-install path', async () => {
      const { parseShellCommand, loadOrInstallAdapter } = await import('../src/shapes/index.js')
      vi.mocked(parseShellCommand).mockReturnValue({ executable: 'apes', argv: ['adapter', 'install', 'curl'], isCompound: false, raw: 'apes adapter install curl' })

      const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
      const result = await requestGrantForShellLine('apes adapter install curl', { targetHost: 'host.test' })

      expect(result.kind).toBe('approved')
      if (result.kind === 'approved')
        expect(result.mode).toBe('self')
      // Must NOT trigger the adapter flow at dispatch time — the user's
      // explicit `adapter install` command is its own handler
      expect(loadOrInstallAdapter).not.toHaveBeenCalled()
    })

    it('exempts `apes admin users list` — server-side auth-gated', async () => {
      const { parseShellCommand } = await import('../src/shapes/index.js')
      vi.mocked(parseShellCommand).mockReturnValue({ executable: 'apes', argv: ['admin', 'users', 'list'], isCompound: false, raw: 'apes admin users list' })

      const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
      const result = await requestGrantForShellLine('apes admin users list', { targetHost: 'host.test' })

      expect(result.kind).toBe('approved')
      if (result.kind === 'approved')
        expect(result.mode).toBe('self')
    })

    it('exempts `apes config set foo bar` — local config write', async () => {
      const { parseShellCommand } = await import('../src/shapes/index.js')
      vi.mocked(parseShellCommand).mockReturnValue({ executable: 'apes', argv: ['config', 'set', 'foo', 'bar'], isCompound: false, raw: 'apes config set foo bar' })

      const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
      const result = await requestGrantForShellLine('apes config set foo bar', { targetHost: 'host.test' })

      expect(result.kind).toBe('approved')
      if (result.kind === 'approved')
        expect(result.mode).toBe('self')
    })

    it('exempts `apes health` even though it does an IdP HEAD probe', async () => {
      const { parseShellCommand } = await import('../src/shapes/index.js')
      vi.mocked(parseShellCommand).mockReturnValue({ executable: 'apes', argv: ['health'], isCompound: false, raw: 'apes health' })

      const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
      const result = await requestGrantForShellLine('apes health', { targetHost: 'host.test' })

      expect(result.kind).toBe('approved')
      if (result.kind === 'approved')
        expect(result.mode).toBe('self')
    })

    it('still gates `apes run -- echo hello` — the core grant-system use case', async () => {
      const { parseShellCommand, loadOrInstallAdapter } = await import('../src/shapes/index.js')
      const { apiFetch } = await import('../src/http.js')
      vi.mocked(parseShellCommand).mockReturnValue({ executable: 'apes', argv: ['run', '--', 'echo', 'hello'], isCompound: false, raw: 'apes run -- echo hello' })
      // No adapter for `apes` specifically — falls through to session grant
      vi.mocked(loadOrInstallAdapter).mockResolvedValue(null)
      // Session-grant lookup returns empty, grant creation returns pending,
      // then approved; the wait loop completes.
      vi.mocked(apiFetch)
        .mockResolvedValueOnce({ data: [] } as any) // list grants
        .mockResolvedValueOnce({ id: 'gated-run', status: 'pending' } as any) // create
        .mockResolvedValueOnce({ status: 'approved' } as any) // poll

      const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
      const result = await requestGrantForShellLine('apes run -- echo hello', { targetHost: 'host.test' })

      // The command DID go through the grant flow, NOT the self-dispatch
      expect(result.kind).toBe('approved')
      if (result.kind === 'approved')
        expect(result.mode).toBe('session')
      expect(loadOrInstallAdapter).toHaveBeenCalled()
      expect(apiFetch).toHaveBeenCalled()
    })

    it('still gates `apes fetch https://example.com` — credential forwarder', async () => {
      const { parseShellCommand, loadOrInstallAdapter } = await import('../src/shapes/index.js')
      const { apiFetch } = await import('../src/http.js')
      vi.mocked(parseShellCommand).mockReturnValue({ executable: 'apes', argv: ['fetch', 'https://example.com'], isCompound: false, raw: 'apes fetch https://example.com' })
      vi.mocked(loadOrInstallAdapter).mockResolvedValue(null)
      vi.mocked(apiFetch)
        .mockResolvedValueOnce({ data: [] } as any)
        .mockResolvedValueOnce({ id: 'gated-fetch', status: 'pending' } as any)
        .mockResolvedValueOnce({ status: 'approved' } as any)

      const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
      const result = await requestGrantForShellLine('apes fetch https://example.com', { targetHost: 'host.test' })

      expect(result.kind).toBe('approved')
      if (result.kind === 'approved')
        expect(result.mode).toBe('session')
      expect(apiFetch).toHaveBeenCalled()
    })

    it('still gates `apes mcp server` — binds a persistent network port', async () => {
      const { parseShellCommand, loadOrInstallAdapter } = await import('../src/shapes/index.js')
      const { apiFetch } = await import('../src/http.js')
      vi.mocked(parseShellCommand).mockReturnValue({ executable: 'apes', argv: ['mcp', 'server'], isCompound: false, raw: 'apes mcp server' })
      vi.mocked(loadOrInstallAdapter).mockResolvedValue(null)
      vi.mocked(apiFetch)
        .mockResolvedValueOnce({ data: [] } as any)
        .mockResolvedValueOnce({ id: 'gated-mcp', status: 'pending' } as any)
        .mockResolvedValueOnce({ status: 'approved' } as any)

      const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
      const result = await requestGrantForShellLine('apes mcp server', { targetHost: 'host.test' })

      expect(result.kind).toBe('approved')
      if (result.kind === 'approved')
        expect(result.mode).toBe('session')
    })

    it('still gates compound commands starting with apes (e.g. `apes whoami | grep alice`)', async () => {
      const { parseShellCommand, loadOrInstallAdapter } = await import('../src/shapes/index.js')
      const { apiFetch } = await import('../src/http.js')
      // Compound → isCompound true → self-dispatch shortcut skips (it only
      // fires for simple single-command lines). Falls through to session.
      vi.mocked(parseShellCommand).mockReturnValue({ executable: 'apes', argv: ['whoami', '|', 'grep', 'alice'], isCompound: true, raw: 'apes whoami | grep alice' })
      vi.mocked(apiFetch)
        .mockResolvedValueOnce({ data: [] } as any)
        .mockResolvedValueOnce({ id: 'compound-grant', status: 'pending' } as any)
        .mockResolvedValueOnce({ status: 'approved' } as any)

      const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
      const result = await requestGrantForShellLine('apes whoami | grep alice', { targetHost: 'host.test' })

      // Compound → fell through to session path, NOT self-dispatched
      expect(result.kind).toBe('approved')
      if (result.kind === 'approved')
        expect(result.mode).toBe('session')
      expect(loadOrInstallAdapter).not.toHaveBeenCalled() // compound short-circuits before adapter
    })

    // ─────────────────────────────────────────────────────────────────
    // Snapshot tripwire: when cli.ts gains a new top-level subcommand,
    // someone has to come here and explicitly classify it. The test
    // fails if either the KNOWN set or the GATED set drifts.
    // ─────────────────────────────────────────────────────────────────

    it('blocklist tripwire: APES_GATED_SUBCOMMANDS stays in sync with known apes subcommands', async () => {
      // Snapshot of all top-level apes subcommands as registered in
      // packages/apes/src/cli.ts as of 0.9.1. When a new subcommand is
      // added, update this list AND decide whether it belongs in the
      // gated set (spawns code / forwards credentials / binds ports)
      // or in the exempt-by-default set (read-only / local config /
      // IdP-auth-gated).
      const KNOWN_APES_SUBCOMMANDS = [
        'init', 'enroll', 'register-user', 'dns-check',
        'login', 'logout', 'whoami', 'health',
        'grants', 'admin', 'run', 'explain', 'adapter',
        'config', 'fetch', 'mcp', 'workflows',
      ].sort()

      // Exactly these three stay gated. Everything else is trusted
      // shell-internal dispatch.
      const EXPECTED_GATED = ['fetch', 'mcp', 'run'].sort()

      // Sanity: the gated set is a real subset of known commands
      for (const sub of EXPECTED_GATED)
        expect(KNOWN_APES_SUBCOMMANDS).toContain(sub)

      // Re-import the module so we're checking the *compiled* blocklist,
      // not a literal from the test file. If someone edits
      // APES_GATED_SUBCOMMANDS in grant-dispatch.ts without updating
      // this test, the assertions below fail.
      const mod = await import('../src/shell/grant-dispatch.js')
      // The blocklist isn't exported — assert behaviorally by driving
      // each known subcommand through requestGrantForShellLine and
      // observing which ones self-dispatch vs fall through.
      const { parseShellCommand, loadOrInstallAdapter } = await import('../src/shapes/index.js')
      const { apiFetch } = await import('../src/http.js')

      const observed: Record<string, 'self' | 'gated'> = {}
      for (const sub of KNOWN_APES_SUBCOMMANDS) {
        vi.clearAllMocks()
        vi.mocked(parseShellCommand).mockReturnValue({ executable: 'apes', argv: [sub], isCompound: false, raw: `apes ${sub}` })
        vi.mocked(loadOrInstallAdapter).mockResolvedValue(null)
        vi.mocked(apiFetch)
          .mockResolvedValueOnce({ data: [] } as any)
          .mockResolvedValueOnce({ id: `probe-${sub}`, status: 'pending' } as any)
          .mockResolvedValueOnce({ status: 'approved' } as any)

        const result = await mod.requestGrantForShellLine(`apes ${sub}`, { targetHost: 'host.test' })
        if (result.kind === 'approved' && result.mode === 'self')
          observed[sub] = 'self'
        else observed[sub] = 'gated'
      }

      const observedGated = Object.entries(observed).filter(([, v]) => v === 'gated').map(([k]) => k).sort()
      expect(observedGated).toEqual(EXPECTED_GATED)
    })
  })
})
