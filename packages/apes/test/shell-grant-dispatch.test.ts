import consola from 'consola'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// We mock every dependency of the grant-dispatch module so tests run
// without touching the network, filesystem, or auth state. The goal is to
// verify the flow control logic: program path vs session path, reuse vs
// request, approval vs denial — not the actual IdP integration (that's
// covered in commands.test.ts via the in-process IdP).

vi.mock('../src/config.js', () => ({
  loadAuth: vi.fn(),
}))
vi.mock('../src/http.js', () => ({
  apiFetch: vi.fn(),
  getGrantsEndpoint: vi.fn(async () => 'http://idp.test/api/grants'),
}))
vi.mock('../src/shapes/index.js', async () => ({
  // Real implementation on purpose — #1083 is about the call sites obeying it.
  isAutoApproved: (await vi.importActual<typeof import('../src/shapes/grants.js')>('../src/shapes/grants.js')).isAutoApproved,
  parseShellCommand: vi.fn(),
  // Real on purpose, like isAutoApproved above: the announced deadline must be
  // the one this module actually waits for, and a stubbed clock would hide a
  // drift between the two (#1306).
  GRANT_WAIT_MS: (await vi.importActual<typeof import('../src/shapes/grants.js')>('../src/shapes/grants.js')).GRANT_WAIT_MS,
  waitsUntil: (await vi.importActual<typeof import('../src/shapes/grants.js')>('../src/shapes/grants.js')).waitsUntil,
}))
// Program lines are authorized at the IdP; the real round trip is covered in
// program-authorization.test.ts. Here only the dispatch decision matters, so no
// program is found unless a test says so.
vi.mock('../src/authorization/program.js', async () => ({
  ...(await vi.importActual<typeof import('../src/authorization/program.js')>('../src/authorization/program.js')),
  locateProgram: vi.fn(async () => null),
  authorizeProgramCall: vi.fn(),
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
    const { parseShellCommand } = await import('../src/shapes/index.js')
    const { locateProgram } = await import('../src/authorization/program.js')
    vi.mocked(parseShellCommand).mockReturnValue({ executable: 'sudo', argv: ['apt', 'install', 'ffmpeg'], isCompound: false, raw: 'sudo apt install ffmpeg' })

    const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
    const result = await requestGrantForShellLine('sudo apt install ffmpeg', { targetHost: 'host.test' })

    expect(result).toEqual({
      kind: 'denied',
      reason: expect.stringContaining('apes run --as root -- apt install ffmpeg'),
    })
    // Must short-circuit before any program lookup.
    expect(locateProgram).not.toHaveBeenCalled()
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

  it('`apes run --as root -- brew services restart ollama` self-dispatches (escapes flow)', async () => {
    const { parseShellCommand } = await import('../src/shapes/index.js')
    const { locateProgram } = await import('../src/authorization/program.js')
    vi.mocked(parseShellCommand).mockReturnValue({
      executable: 'apes',
      argv: ['run', '--as', 'root', '--', 'brew', 'services', 'restart', 'ollama'],
      isCompound: false,
      raw: 'apes run --as root -- brew services restart ollama',
    })

    const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
    const result = await requestGrantForShellLine('apes run --as root -- brew services restart ollama', { targetHost: 'host.test' })

    expect(result).toEqual({ kind: 'approved', grantId: 'shell-internal', mode: 'self' })
    expect(locateProgram).not.toHaveBeenCalled()
  })

  it('`apes run -- echo hi` without --as STAYS gated', async () => {
    const { parseShellCommand } = await import('../src/shapes/index.js')
    const { locateProgram } = await import('../src/authorization/program.js')
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(parseShellCommand).mockReturnValue({
      executable: 'apes',
      argv: ['run', '--', 'echo', 'hi'],
      isCompound: false,
      raw: 'apes run -- echo hi',
    })
    vi.mocked(locateProgram).mockResolvedValue(null)
    vi.mocked(apiFetch)
      .mockResolvedValueOnce({ data: [] } as any)
      .mockResolvedValueOnce({ id: 'gated-run', status: 'pending' } as any)
      .mockResolvedValueOnce({ status: 'approved' } as any)

    const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
    const result = await requestGrantForShellLine('apes run -- echo hi', { targetHost: 'host.test' })

    // Must NOT self-dispatch — no --as flag
    expect(result).toEqual({ kind: 'approved', grantId: 'gated-run', mode: 'session' })
  })

  it('falls back to a session grant when the command is compound', async () => {
    const { parseShellCommand } = await import('../src/shapes/index.js')
    const { locateProgram } = await import('../src/authorization/program.js')
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
    // A compound line is never treated as a program call
    expect(locateProgram).not.toHaveBeenCalled()
  })

  // #1083 — the "a grant is waiting for you" channel is only worth something if
  // it never fires for something the IdP already decided by itself.
  it('does NOT notify the owner when the session grant is auto-approved', async () => {
    const { parseShellCommand } = await import('../src/shapes/index.js')
    const { apiFetch } = await import('../src/http.js')
    const { notifyGrantPending } = await import('../src/notifications.js')
    vi.mocked(parseShellCommand).mockReturnValue({ executable: 'ls', argv: ['|'], isCompound: true, raw: 'ls | grep foo' })

    vi.mocked(apiFetch)
      .mockResolvedValueOnce({ data: [] } as any) // list grants
      .mockResolvedValueOnce({ id: 'yolo-grant', status: 'approved', approved_automatically: true } as any)
      .mockResolvedValueOnce({ status: 'approved' } as any) // poll

    const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
    const result = await requestGrantForShellLine('ls | grep foo', { targetHost: 'host.test' })

    expect(result).toEqual({ kind: 'approved', grantId: 'yolo-grant', mode: 'session' })
    expect(notifyGrantPending).not.toHaveBeenCalled()
  })

  it('DOES notify the owner when the session grant really is pending', async () => {
    const { parseShellCommand } = await import('../src/shapes/index.js')
    const { apiFetch } = await import('../src/http.js')
    const { notifyGrantPending } = await import('../src/notifications.js')
    vi.mocked(parseShellCommand).mockReturnValue({ executable: 'ls', argv: ['|'], isCompound: true, raw: 'ls | grep foo' })

    vi.mocked(apiFetch)
      .mockResolvedValueOnce({ data: [] } as any)
      .mockResolvedValueOnce({ id: 'pending-grant', status: 'pending' } as any)
      .mockResolvedValueOnce({ status: 'approved' } as any)

    const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
    await requestGrantForShellLine('ls | grep foo', { targetHost: 'host.test' })

    expect(notifyGrantPending).toHaveBeenCalledWith(expect.objectContaining({ grantId: 'pending-grant' }))
  })

  it('reuses an existing timed session grant when one is found', async () => {
    const { parseShellCommand } = await import('../src/shapes/index.js')
    const { locateProgram } = await import('../src/authorization/program.js')
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
    expect(locateProgram).not.toHaveBeenCalled()
  })

  it('falls back to session grant when no executable file is found for the program', async () => {
    const { parseShellCommand } = await import('../src/shapes/index.js')
    const { locateProgram } = await import('../src/authorization/program.js')
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(parseShellCommand).mockReturnValue({ executable: 'obscure-tool', argv: ['--foo'], isCompound: false, raw: 'obscure-tool --foo' })
    vi.mocked(locateProgram).mockResolvedValue(null)

    vi.mocked(apiFetch)
      .mockResolvedValueOnce({ data: [] } as any)
      .mockResolvedValueOnce({ id: 'fallback-grant', status: 'pending' } as any)
      .mockResolvedValueOnce({ status: 'approved' } as any)

    const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
    const result = await requestGrantForShellLine('obscure-tool --foo', { targetHost: 'host.test' })

    expect(result).toEqual({ kind: 'approved', grantId: 'fallback-grant', mode: 'session' })
  })

  describe('program lines (authorized per call at the IdP)', () => {
    const lsProgram = { path: '/bin/ls', name: 'ls', sha256: 'a'.repeat(64) }

    it('authorizes a plain program line and approves it in program mode', async () => {
      const { locateProgram, authorizeProgramCall } = await import('../src/authorization/program.js')
      const { apiFetch } = await import('../src/http.js')
      vi.mocked(locateProgram).mockResolvedValue(lsProgram)
      vi.mocked(authorizeProgramCall).mockResolvedValue({ kind: 'authorized', grantId: 'program-grant', token: 't', claims: {} as any })

      const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
      const result = await requestGrantForShellLine('ls -la', { targetHost: 'host.test' })

      // bash runs the authorized file and argv, never the typed line
      expect(result).toEqual({ kind: 'approved', grantId: 'program-grant', mode: 'program', command: '\\builtin command -- \'/bin/ls\' \'-la\'' })
      expect(locateProgram).toHaveBeenCalledWith('ls')
      expect(authorizeProgramCall).toHaveBeenCalledWith(
        { program: lsProgram, argv: ['-la'] },
        expect.objectContaining({ idp: 'http://idp.test', subject: 'alice@example.com', targetHost: 'host.test', grantType: 'once', wait: true }),
      )
      expect(apiFetch).not.toHaveBeenCalled()
    })

    it('denies the line when the IdP refuses it, without a session-grant fallback', async () => {
      const { locateProgram, authorizeProgramCall, AuthorizationRefusedError } = await import('../src/authorization/program.js')
      const { apiFetch } = await import('../src/http.js')
      vi.mocked(locateProgram).mockResolvedValue(lsProgram)
      vi.mocked(authorizeProgramCall).mockRejectedValue(new AuthorizationRefusedError('denied', 'scary-grant'))

      const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
      const result = await requestGrantForShellLine('ls -la', { targetHost: 'host.test' })

      expect(result).toEqual({ kind: 'denied', reason: 'Grant scary-grant denied' })
      expect(apiFetch).not.toHaveBeenCalled()
    })

    it('denies the line when the approval wait times out', async () => {
      const { locateProgram, authorizeProgramCall, AuthorizationTimeoutError } = await import('../src/authorization/program.js')
      vi.mocked(locateProgram).mockResolvedValue(lsProgram)
      vi.mocked(authorizeProgramCall).mockRejectedValue(new AuthorizationTimeoutError('slow-grant', 300_000))

      const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
      const result = await requestGrantForShellLine('ls -la', { targetHost: 'host.test' })

      expect(result.kind).toBe('denied')
      if (result.kind === 'denied')
        expect(result.reason).toContain('timed out')
    })

    it('refuses a relative program path, which this process would resolve against another directory than bash', async () => {
      const { locateProgram, authorizeProgramCall } = await import('../src/authorization/program.js')

      const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
      const result = await requestGrantForShellLine('./tool --flag', { targetHost: 'host.test' })

      expect(result).toEqual({ kind: 'denied', reason: 'Use an absolute path or a program on PATH instead of ./tool' })
      expect(locateProgram).not.toHaveBeenCalled()
      expect(authorizeProgramCall).not.toHaveBeenCalled()
    })

    it('keeps builtins and lines with expansions on the session path', async () => {
      const { parseShellCommand } = await import('../src/shapes/index.js')
      const { locateProgram } = await import('../src/authorization/program.js')
      const { apiFetch } = await import('../src/http.js')
      vi.mocked(parseShellCommand).mockReturnValue({ executable: 'cd', argv: ['/tmp'], isCompound: false, raw: 'cd /tmp' })
      vi.mocked(apiFetch).mockResolvedValue({ data: [{ id: 'session', status: 'approved', request: { audience: 'ape-shell', target_host: 'host.test', grant_type: 'always' } }] } as any)

      const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
      for (const line of ['cd /tmp', 'ls $HOME', 'ls *.txt', 'FOO=1 ls', 'ls ~/x', 'ls; id', 'echo $(id)', 'ls > out'])
        expect(await requestGrantForShellLine(line, { targetHost: 'host.test' })).toEqual({ kind: 'approved', grantId: 'session', mode: 'session' })
      expect(locateProgram).not.toHaveBeenCalled()
    })
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

  it('emits stderr progress lines while the session grant poll is pending (#1065)', async () => {
    vi.useFakeTimers()
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      const { parseShellCommand } = await import('../src/shapes/index.js')
      const { apiFetch } = await import('../src/http.js')
      vi.mocked(parseShellCommand).mockReturnValue({ executable: 'ls', argv: ['|'], isCompound: true, raw: 'ls | grep foo' })

      // list → create → 6× pending (t=0..15 s) → approved (t=18 s):
      // exactly one progress line is due, at the 15 s mark.
      vi.mocked(apiFetch)
        .mockResolvedValueOnce({ data: [] } as any)
        .mockResolvedValueOnce({ id: 'slow-session-grant', status: 'pending' } as any)
        .mockResolvedValueOnce({ status: 'pending' } as any)
        .mockResolvedValueOnce({ status: 'pending' } as any)
        .mockResolvedValueOnce({ status: 'pending' } as any)
        .mockResolvedValueOnce({ status: 'pending' } as any)
        .mockResolvedValueOnce({ status: 'pending' } as any)
        .mockResolvedValueOnce({ status: 'pending' } as any)
        .mockResolvedValueOnce({ status: 'approved' } as any)

      const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
      const promise = requestGrantForShellLine('ls | grep foo', { targetHost: 'host.test' })
      await vi.advanceTimersByTimeAsync(30_000)
      const result = await promise

      expect(result).toEqual({ kind: 'approved', grantId: 'slow-session-grant', mode: 'session' })
      const progress = stderrWrite.mock.calls
        .map(call => String(call[0]))
        .filter(line => line.includes('still waiting'))
      expect(progress).toHaveLength(1)
      expect(progress[0]).toContain('15s')
      expect(progress[0]).toContain('slow-ses')
    }
    finally {
      stderrWrite.mockRestore()
      vi.useRealTimers()
    }
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
      const { parseShellCommand } = await import('../src/shapes/index.js')
      const { locateProgram } = await import('../src/authorization/program.js')
      const { apiFetch } = await import('../src/http.js')
      vi.mocked(parseShellCommand).mockReturnValue({ executable: 'apes', argv: ['whoami'], isCompound: false, raw: 'apes whoami' })

      const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
      const result = await requestGrantForShellLine('apes whoami', { targetHost: 'host.test' })

      expect(result).toEqual({ kind: 'approved', grantId: 'shell-internal', mode: 'self' })
      // Critical: the program + session paths must NOT be reached
      expect(locateProgram).not.toHaveBeenCalled()
      expect(apiFetch).not.toHaveBeenCalled()
    })

    it('exempts `apes grants run <id>` — the async-flow bootstrap case', async () => {
      const { parseShellCommand } = await import('../src/shapes/index.js')
      const { locateProgram } = await import('../src/authorization/program.js')
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
      expect(locateProgram).not.toHaveBeenCalled()
      expect(apiFetch).not.toHaveBeenCalled()
    })

    it('exempts `apes grants list`', async () => {
      const { parseShellCommand } = await import('../src/shapes/index.js')
      const { locateProgram } = await import('../src/authorization/program.js')
      vi.mocked(parseShellCommand).mockReturnValue({ executable: 'apes', argv: ['grants', 'list'], isCompound: false, raw: 'apes grants list' })

      const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
      const result = await requestGrantForShellLine('apes grants list', { targetHost: 'host.test' })

      expect(result.kind).toBe('approved')
      if (result.kind === 'approved')
        expect(result.mode).toBe('self')
      expect(locateProgram).not.toHaveBeenCalled()
    })

    it('exempts `apes adapter list` — reads the public adapter list of the IdP', async () => {
      const { parseShellCommand } = await import('../src/shapes/index.js')
      const { locateProgram } = await import('../src/authorization/program.js')
      vi.mocked(parseShellCommand).mockReturnValue({ executable: 'apes', argv: ['adapter', 'list'], isCompound: false, raw: 'apes adapter list' })

      const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
      const result = await requestGrantForShellLine('apes adapter list', { targetHost: 'host.test' })

      expect(result.kind).toBe('approved')
      if (result.kind === 'approved')
        expect(result.mode).toBe('self')
      // Must NOT trigger the adapter flow at dispatch time — the user's
      // explicit `adapter install` command is its own handler
      expect(locateProgram).not.toHaveBeenCalled()
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
      const { parseShellCommand } = await import('../src/shapes/index.js')
      const { locateProgram } = await import('../src/authorization/program.js')
      const { apiFetch } = await import('../src/http.js')
      vi.mocked(parseShellCommand).mockReturnValue({ executable: 'apes', argv: ['run', '--', 'echo', 'hello'], isCompound: false, raw: 'apes run -- echo hello' })
      // No adapter for `apes` specifically — falls through to session grant
      vi.mocked(locateProgram).mockResolvedValue(null)
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
      expect(locateProgram).toHaveBeenCalled()
      expect(apiFetch).toHaveBeenCalled()
    })

    it('still gates `apes fetch https://example.com` — credential forwarder', async () => {
      const { parseShellCommand } = await import('../src/shapes/index.js')
      const { locateProgram } = await import('../src/authorization/program.js')
      const { apiFetch } = await import('../src/http.js')
      vi.mocked(parseShellCommand).mockReturnValue({ executable: 'apes', argv: ['fetch', 'https://example.com'], isCompound: false, raw: 'apes fetch https://example.com' })
      vi.mocked(locateProgram).mockResolvedValue(null)
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
      const { parseShellCommand } = await import('../src/shapes/index.js')
      const { locateProgram } = await import('../src/authorization/program.js')
      const { apiFetch } = await import('../src/http.js')
      vi.mocked(parseShellCommand).mockReturnValue({ executable: 'apes', argv: ['mcp', 'server'], isCompound: false, raw: 'apes mcp server' })
      vi.mocked(locateProgram).mockResolvedValue(null)
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
      const { parseShellCommand } = await import('../src/shapes/index.js')
      const { locateProgram } = await import('../src/authorization/program.js')
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
      expect(locateProgram).not.toHaveBeenCalled() // compound short-circuits before adapter
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
      const { parseShellCommand } = await import('../src/shapes/index.js')
      const { locateProgram } = await import('../src/authorization/program.js')
      const { apiFetch } = await import('../src/http.js')

      const observed: Record<string, 'self' | 'gated'> = {}
      for (const sub of KNOWN_APES_SUBCOMMANDS) {
        vi.clearAllMocks()
        vi.mocked(parseShellCommand).mockReturnValue({ executable: 'apes', argv: [sub], isCompound: false, raw: `apes ${sub}` })
        vi.mocked(locateProgram).mockResolvedValue(null)
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
