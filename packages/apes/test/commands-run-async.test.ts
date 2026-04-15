import consola from 'consola'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Test the non-blocking default behaviour of `apes run` / `ape-shell -c`.
//
// All four grant-wait sites in `src/commands/run.ts` must, by default, print
// an async info block and exit without polling or executing. Adding `--wait`
// or `APE_WAIT=1` restores the legacy blocking behaviour.

vi.mock('../src/config.js', () => ({
  loadAuth: vi.fn(() => ({
    email: 'alice@example.com',
    idp: 'http://idp.test',
    expires_at: Date.now() / 1000 + 3600,
  })),
  getIdpUrl: vi.fn(() => 'http://idp.test'),
  // Async info block helpers in run.ts call loadConfig() to resolve
  // APES_USER / poll interval / poll max minutes from config.toml when
  // the matching env vars aren't set. Return an empty config by default
  // so tests get the baked-in defaults; individual tests can override
  // via `vi.mocked(loadConfig).mockReturnValueOnce(...)`.
  loadConfig: vi.fn(() => ({})),
}))

vi.mock('../src/http.js', () => ({
  apiFetch: vi.fn(),
  getGrantsEndpoint: vi.fn(async () => 'http://idp.test/api/grants'),
  ApiError: class extends Error {},
}))

vi.mock('../src/shapes/index.js', () => ({
  createShapesGrant: vi.fn(),
  fetchGrantToken: vi.fn(),
  findExistingGrant: vi.fn(),
  loadOrInstallAdapter: vi.fn(),
  loadAdapter: vi.fn(),
  parseShellCommand: vi.fn(),
  resolveCommand: vi.fn(),
  verifyAndExecute: vi.fn(),
  verifyAndConsume: vi.fn(),
  waitForGrantStatus: vi.fn(),
  extractOption: vi.fn(() => undefined),
  extractShellCommandString: vi.fn((cmd: string[]) => cmd.at(-1) ?? ''),
  extractWrappedCommand: vi.fn((argv: string[]) => {
    const idx = argv.indexOf('--')
    return idx >= 0 ? argv.slice(idx + 1) : []
  }),
}))

vi.mock('../src/notifications.js', () => ({
  notifyGrantPending: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}))

function makeResolved(display = 'curl https://example.com') {
  return {
    detail: { display, permission: display },
    adapter: { cli: { audience: 'shapes', executable: 'curl' } },
  } as any
}

/**
 * Wait for a promise that should throw `CliExit(expectedCode)`. As of
 * 0.10.0 every async-default exit path in `runCommand` throws CliExit
 * with the configured exit code (default 75 = EX_TEMPFAIL) instead of
 * returning 0. Tests that exercise those paths use this helper to catch
 * the throw while still running their post-hoc assertions on the spies
 * (which were populated during the print BEFORE the throw).
 *
 * The legacy sync path (--wait / APE_WAIT=1) still returns normally,
 * so --wait tests continue to `await runCommand.run!(...)` directly.
 */
async function expectCliExit(promise: Promise<unknown>, expectedCode: number = 75): Promise<void> {
  const { CliExit } = await import('../src/errors.js')
  try {
    await promise
  }
  catch (err) {
    if (err instanceof CliExit) {
      expect(err.exitCode).toBe(expectedCode)
      return
    }
    throw err
  }
  throw new Error(`Expected CliExit(${expectedCode}) but promise resolved normally`)
}

describe('commands/run async default', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>
  let infoSpy: ReturnType<typeof vi.spyOn>
  let successSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    vi.clearAllMocks()
    // Reset loadConfig to an empty default so a prior test's
    // mockReturnValue doesn't leak through the describe block. Individual
    // tests that need a config override use `vi.mocked(loadConfig)
    // .mockReturnValue(...)` inside the test body.
    const { loadConfig } = await import('../src/config.js')
    vi.mocked(loadConfig).mockReturnValue({})
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    infoSpy = vi.spyOn(consola, 'info').mockImplementation(() => {})
    successSpy = vi.spyOn(consola, 'success').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleLogSpy.mockRestore()
    infoSpy.mockRestore()
    successSpy.mockRestore()
    delete process.env.APE_WAIT
  })

  function assertAsyncInfoBlock(grantId: string) {
    const allOutput = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n')
    const successOutput = successSpy.mock.calls.map(c => c.join(' ')).join('\n')
    expect(successOutput).toContain(grantId)
    expect(allOutput).toContain(`grant-approval?grant_id=${grantId}`)
    expect(allOutput).toContain(`apes grants run ${grantId}`)
    expect(allOutput).toContain(`apes grants status ${grantId}`)
  }

  // ------------------------------------------------------------------------
  // Site #2 — tryAdapterModeFromShell (ape-shell -c "single cmd" path)
  // ------------------------------------------------------------------------
  describe('tryAdapterModeFromShell (shell adapter path)', () => {
    it('async default: prints grant info and exits without waiting', async () => {
      const shapes = await import('../src/shapes/index.js')
      vi.mocked(shapes.parseShellCommand).mockReturnValue({
        executable: 'curl',
        argv: ['https://example.com'],
        isCompound: false,
        raw: 'curl https://example.com',
      } as any)
      vi.mocked(shapes.loadOrInstallAdapter).mockResolvedValue({} as any)
      vi.mocked(shapes.resolveCommand).mockResolvedValue(makeResolved())
      vi.mocked(shapes.findExistingGrant).mockResolvedValue(null)
      vi.mocked(shapes.createShapesGrant).mockResolvedValue({ id: 'grant-abc' } as any)

      const { runCommand } = await import('../src/commands/run.js')
      await expectCliExit(runCommand.run!({
        rawArgs: ['run', '--shell', '--', 'bash', '-c', 'curl https://example.com'],
        args: { shell: true, wait: false, approval: 'once' } as any,
      } as any))

      expect(shapes.waitForGrantStatus).not.toHaveBeenCalled()
      expect(shapes.verifyAndExecute).not.toHaveBeenCalled()
      assertAsyncInfoBlock('grant-abc')
    })

    it('--wait flag: takes legacy blocking path', async () => {
      const shapes = await import('../src/shapes/index.js')
      vi.mocked(shapes.parseShellCommand).mockReturnValue({
        executable: 'curl',
        argv: ['https://example.com'],
        isCompound: false,
        raw: 'curl https://example.com',
      } as any)
      vi.mocked(shapes.loadOrInstallAdapter).mockResolvedValue({} as any)
      vi.mocked(shapes.resolveCommand).mockResolvedValue(makeResolved())
      vi.mocked(shapes.findExistingGrant).mockResolvedValue(null)
      vi.mocked(shapes.createShapesGrant).mockResolvedValue({ id: 'grant-abc' } as any)
      vi.mocked(shapes.waitForGrantStatus).mockResolvedValue('approved')
      vi.mocked(shapes.fetchGrantToken).mockResolvedValue('tok' as any)
      vi.mocked(shapes.verifyAndExecute).mockResolvedValue(undefined as any)

      const { runCommand } = await import('../src/commands/run.js')
      await runCommand.run!({
        rawArgs: ['run', '--shell', '--wait', '--', 'bash', '-c', 'curl https://example.com'],
        args: { shell: true, wait: true, approval: 'once' } as any,
      } as any)

      expect(shapes.waitForGrantStatus).toHaveBeenCalledWith('http://idp.test', 'grant-abc')
      expect(shapes.verifyAndExecute).toHaveBeenCalled()
      // Async info block should NOT have been printed
      const allOutput = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n')
      expect(allOutput).not.toContain('apes grants run grant-abc')
    })

    it('APE_WAIT=1 env: takes legacy blocking path', async () => {
      process.env.APE_WAIT = '1'
      const shapes = await import('../src/shapes/index.js')
      vi.mocked(shapes.parseShellCommand).mockReturnValue({
        executable: 'curl',
        argv: ['https://example.com'],
        isCompound: false,
        raw: 'curl https://example.com',
      } as any)
      vi.mocked(shapes.loadOrInstallAdapter).mockResolvedValue({} as any)
      vi.mocked(shapes.resolveCommand).mockResolvedValue(makeResolved())
      vi.mocked(shapes.findExistingGrant).mockResolvedValue(null)
      vi.mocked(shapes.createShapesGrant).mockResolvedValue({ id: 'grant-env' } as any)
      vi.mocked(shapes.waitForGrantStatus).mockResolvedValue('approved')
      vi.mocked(shapes.fetchGrantToken).mockResolvedValue('tok' as any)
      vi.mocked(shapes.verifyAndExecute).mockResolvedValue(undefined as any)

      const { runCommand } = await import('../src/commands/run.js')
      await runCommand.run!({
        rawArgs: ['run', '--shell', '--', 'bash', '-c', 'curl https://example.com'],
        args: { shell: true, wait: false, approval: 'once' } as any,
      } as any)

      expect(shapes.waitForGrantStatus).toHaveBeenCalled()
      expect(shapes.verifyAndExecute).toHaveBeenCalled()
    })

    it('cache hit via findExistingGrant: executes immediately, no async exit', async () => {
      const shapes = await import('../src/shapes/index.js')
      vi.mocked(shapes.parseShellCommand).mockReturnValue({
        executable: 'curl',
        argv: ['https://example.com'],
        isCompound: false,
        raw: 'curl https://example.com',
      } as any)
      vi.mocked(shapes.loadOrInstallAdapter).mockResolvedValue({} as any)
      vi.mocked(shapes.resolveCommand).mockResolvedValue(makeResolved())
      vi.mocked(shapes.findExistingGrant).mockResolvedValue('existing-grant-1')
      vi.mocked(shapes.fetchGrantToken).mockResolvedValue('tok' as any)
      vi.mocked(shapes.verifyAndExecute).mockResolvedValue(undefined as any)

      const { runCommand } = await import('../src/commands/run.js')
      await runCommand.run!({
        rawArgs: ['run', '--shell', '--', 'bash', '-c', 'curl https://example.com'],
        args: { shell: true, wait: false, approval: 'once' } as any,
      } as any)

      expect(shapes.createShapesGrant).not.toHaveBeenCalled()
      expect(shapes.verifyAndExecute).toHaveBeenCalledWith('tok', expect.anything())
      const allOutput = consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n')
      expect(allOutput).not.toContain('apes grants run')
    })
  })

  // ------------------------------------------------------------------------
  // Site #1 — runShellMode session grant (when adapter path returns false)
  // ------------------------------------------------------------------------
  describe('runShellMode (session grant fallback)', () => {
    it('async default: prints info and does NOT exec shell command', async () => {
      const shapes = await import('../src/shapes/index.js')
      // Force adapter path to bail (compound command)
      vi.mocked(shapes.parseShellCommand).mockReturnValue(null as any)

      const { apiFetch } = await import('../src/http.js')
      vi.mocked(apiFetch)
        .mockResolvedValueOnce({ data: [] } as any) // grants list lookup
        .mockResolvedValueOnce({ id: 'sess-1', status: 'pending' } as any) // create

      const { execFileSync } = await import('node:child_process')

      const { runCommand } = await import('../src/commands/run.js')
      await expectCliExit(runCommand.run!({
        rawArgs: ['run', '--shell', '--', 'bash', '-c', 'echo a | echo b'],
        args: { shell: true, wait: false, approval: 'once' } as any,
      } as any))

      expect(execFileSync).not.toHaveBeenCalled()
      assertAsyncInfoBlock('sess-1')
    })

    it('--wait flag: polls and executes shell command', async () => {
      const shapes = await import('../src/shapes/index.js')
      vi.mocked(shapes.parseShellCommand).mockReturnValue(null as any)

      const { apiFetch } = await import('../src/http.js')
      vi.mocked(apiFetch)
        .mockResolvedValueOnce({ data: [] } as any) // grants list lookup
        .mockResolvedValueOnce({ id: 'sess-2', status: 'pending' } as any) // create
        .mockResolvedValueOnce({ status: 'approved' } as any) // poll

      const { execFileSync } = await import('node:child_process')

      const { runCommand } = await import('../src/commands/run.js')
      await runCommand.run!({
        rawArgs: ['run', '--shell', '--wait', '--', 'bash', '-c', 'echo a | echo b'],
        args: { shell: true, wait: true, approval: 'once' } as any,
      } as any)

      expect(execFileSync).toHaveBeenCalled()
    })
  })

  // ------------------------------------------------------------------------
  // Site #3 — runAdapterMode (apes run -- cmd without --shell)
  // ------------------------------------------------------------------------
  describe('runAdapterMode', () => {
    it('async default: prints grant info and does NOT call waitForGrantStatus', async () => {
      const shapes = await import('../src/shapes/index.js')
      vi.mocked(shapes.loadAdapter).mockReturnValue({} as any)
      vi.mocked(shapes.resolveCommand).mockResolvedValue(makeResolved('whoami'))
      vi.mocked(shapes.findExistingGrant).mockResolvedValue(null)
      vi.mocked(shapes.createShapesGrant).mockResolvedValue({ id: 'grant-xyz' } as any)

      const { runCommand } = await import('../src/commands/run.js')
      await expectCliExit(runCommand.run!({
        rawArgs: ['run', '--', 'whoami'],
        args: { shell: false, wait: false, approval: 'once' } as any,
      } as any))

      expect(shapes.waitForGrantStatus).not.toHaveBeenCalled()
      expect(shapes.verifyAndExecute).not.toHaveBeenCalled()
      assertAsyncInfoBlock('grant-xyz')
    })

    it('--wait flag: blocking path executes', async () => {
      const shapes = await import('../src/shapes/index.js')
      vi.mocked(shapes.loadAdapter).mockReturnValue({} as any)
      vi.mocked(shapes.resolveCommand).mockResolvedValue(makeResolved('whoami'))
      vi.mocked(shapes.findExistingGrant).mockResolvedValue(null)
      vi.mocked(shapes.createShapesGrant).mockResolvedValue({ id: 'grant-xyz' } as any)
      vi.mocked(shapes.waitForGrantStatus).mockResolvedValue('approved')
      vi.mocked(shapes.fetchGrantToken).mockResolvedValue('tok' as any)
      vi.mocked(shapes.verifyAndExecute).mockResolvedValue(undefined as any)

      const { runCommand } = await import('../src/commands/run.js')
      await runCommand.run!({
        rawArgs: ['run', '--wait', '--', 'whoami'],
        args: { shell: false, wait: true, approval: 'once' } as any,
      } as any)

      expect(shapes.waitForGrantStatus).toHaveBeenCalledWith('http://idp.test', 'grant-xyz')
      expect(shapes.verifyAndExecute).toHaveBeenCalledWith('tok', expect.anything())
    })
  })

  // ------------------------------------------------------------------------
  // Site #4 — runAudienceMode (apes run <audience> <action>)
  // ------------------------------------------------------------------------
  describe('runAudienceMode', () => {
    it('async default: prints info, no poll, no escapes exec', async () => {
      const { apiFetch } = await import('../src/http.js')
      vi.mocked(apiFetch).mockResolvedValueOnce({ id: 'aud-1', status: 'pending' } as any)

      const { execFileSync } = await import('node:child_process')

      const { runCommand } = await import('../src/commands/run.js')
      await expectCliExit(runCommand.run!({
        rawArgs: ['run', 'escapes', 'mount-nfs'],
        args: { shell: false, wait: false, approval: 'once', 'escapes-path': 'escapes' } as any,
      } as any))

      // Only the grant-create call; no poll, no token fetch
      expect(apiFetch).toHaveBeenCalledTimes(1)
      expect(execFileSync).not.toHaveBeenCalled()
      assertAsyncInfoBlock('aud-1')
    })

    it('--wait flag: polls, fetches token, pipes to escapes', async () => {
      const { apiFetch } = await import('../src/http.js')
      vi.mocked(apiFetch)
        .mockResolvedValueOnce({ id: 'aud-2', status: 'pending' } as any) // create
        .mockResolvedValueOnce({ status: 'pending' } as any) // poll 1
        .mockResolvedValueOnce({ status: 'approved' } as any) // poll 2
        .mockResolvedValueOnce({ authz_jwt: 'jwt-tok' } as any) // token

      const { execFileSync } = await import('node:child_process')
      vi.mocked(execFileSync).mockReturnValue(Buffer.from(''))

      const { runCommand } = await import('../src/commands/run.js')
      await runCommand.run!({
        rawArgs: ['run', 'escapes', 'mount-nfs', '--wait'],
        args: { shell: false, wait: true, approval: 'once', 'escapes-path': 'escapes' } as any,
      } as any)

      expect(execFileSync).toHaveBeenCalledWith(
        'escapes',
        ['--grant', 'jwt-tok', '--', 'mount-nfs'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })
  })

  // ------------------------------------------------------------------------
  // Async info block audience: agent (default) vs human
  //
  // The output of printPendingGrantInfo switches between two flavours:
  //   - agent (default): verbose, with an explicit polling protocol
  //   - human (opt-in via APES_USER=human or config.toml defaults.user)
  //
  // APES_USER env var wins over config.toml. Numeric knobs
  // (APES_GRANT_POLL_INTERVAL, APES_GRANT_POLL_MAX_MINUTES) flow into the
  // agent-mode text so different environments can tune the polling policy.
  // ------------------------------------------------------------------------
  describe('async info block audience mode', () => {
    // All cases below go through the simplest exit path we have — the
    // runAudienceMode async branch — to avoid re-mocking the shapes
    // adapter chain. printPendingGrantInfo is the same helper in every
    // call site, so one driving path is representative.
    async function driveRun(expectedExitCode: number = 75) {
      const { apiFetch } = await import('../src/http.js')
      vi.mocked(apiFetch).mockResolvedValueOnce({ id: 'grant-mode-test', status: 'pending' } as any)

      const { runCommand } = await import('../src/commands/run.js')
      await expectCliExit(
        runCommand.run!({
          rawArgs: ['run', 'escapes', 'mount-nfs'],
          args: { shell: false, wait: false, approval: 'once' } as any,
        } as any),
        expectedExitCode,
      )
    }

    function collectedLog(): string {
      return consoleLogSpy.mock.calls.map(c => c.join(' ')).join('\n')
    }

    function collectedSuccess(): string {
      return successSpy.mock.calls.map(c => c.join(' ')).join('\n')
    }

    afterEach(() => {
      delete process.env.APES_USER
      delete process.env.APES_GRANT_POLL_INTERVAL
      delete process.env.APES_GRANT_POLL_MAX_MINUTES
    })

    it('default (no env, no config): agent mode with "call --wait" instruction', async () => {
      await driveRun()

      const out = collectedLog()
      const success = collectedSuccess()

      expect(success).toContain('Grant grant-mode-test created (pending approval)')
      // Core instruction: call `apes grants run <id> --wait`, CLI handles polling.
      expect(out).toContain('For agents:')
      expect(out).toContain('apes grants run grant-mode-test --wait')
      expect(out).toContain('up to 5 minutes')
      // Exit 75 explanation is critical so agent frameworks don't abort.
      expect(out).toContain('exit code 75')
      expect(out).toContain('EX_TEMPFAIL')
      // Must NOT include the human-mode label wording
      expect(out).not.toContain('Approve in browser:')
      expect(out).not.toContain('Run after approval:')
      // The old "poll every 10s" instruction must NOT leak through — it
      // was replaced by the CLI-side --wait pattern and agent frameworks
      // should not see a mix of both.
      expect(out).not.toContain('poll `apes grants status')
      expect(out).not.toContain('every 10s')
    })

    it('APES_USER=human: short block, no agent protocol', async () => {
      process.env.APES_USER = 'human'
      await driveRun()

      const out = collectedLog()
      const success = collectedSuccess()

      expect(success).toContain('Grant grant-mode-test created — awaiting your approval')
      expect(out).toContain('Approve in browser:')
      expect(out).toContain('Check status:')
      expect(out).toContain('Run after approval:')
      // Agent-only blocks must NOT appear in human mode
      expect(out).not.toContain('For agents:')
      expect(out).not.toContain('--wait')
      expect(out).not.toContain('EX_TEMPFAIL')
    })

    it('APES_USER=agent: same as default', async () => {
      process.env.APES_USER = 'agent'
      await driveRun()

      const out = collectedLog()
      expect(out).toContain('For agents:')
      expect(out).toContain('apes grants run grant-mode-test --wait')
    })

    it('APES_USER=invalid: falls back to agent default', async () => {
      process.env.APES_USER = 'random-garbage-xxxxxxx'
      await driveRun()

      const out = collectedLog()
      expect(out).toContain('For agents:')
    })

    it('config.toml defaults.user=human overrides the agent default', async () => {
      const { loadConfig } = await import('../src/config.js')
      vi.mocked(loadConfig).mockReturnValue({ defaults: { user: 'human' } })
      await driveRun()

      const out = collectedLog()
      expect(out).toContain('Approve in browser:')
      expect(out).not.toContain('For agents:')
    })

    it('APES_USER env wins over config.toml defaults.user', async () => {
      const { loadConfig } = await import('../src/config.js')
      vi.mocked(loadConfig).mockReturnValue({ defaults: { user: 'human' } })
      process.env.APES_USER = 'agent'
      await driveRun()

      const out = collectedLog()
      // Env said agent → agent wins even though config said human
      expect(out).toContain('For agents:')
      expect(out).not.toContain('Approve in browser:')
    })

    it('APES_GRANT_POLL_INTERVAL no longer leaks into the agent text', async () => {
      // 0.10.1: the poll interval is now an internal CLI detail — `apes
      // grants run --wait` polls at APES_GRANT_POLL_INTERVAL internally,
      // and the agent text no longer mentions it. Regression guard that
      // setting the env var does NOT produce any "every Xs" string.
      process.env.APES_GRANT_POLL_INTERVAL = '30'
      await driveRun()

      const out = collectedLog()
      expect(out).not.toContain('every 30s')
      expect(out).not.toContain('every 10s')
      // Default max still 5 minutes; the max IS still surfaced because
      // it informs the user how long they have to approve.
      expect(out).toContain('up to 5 minutes')
    })

    it('APES_GRANT_POLL_MAX_MINUTES=10 flows into the agent text', async () => {
      process.env.APES_GRANT_POLL_MAX_MINUTES = '10'
      await driveRun()

      const out = collectedLog()
      expect(out).toContain('up to 10 minutes')
      expect(out).not.toContain('up to 5 minutes')
    })

    it('config fallback for grant_poll_max_minutes when env unset', async () => {
      const { loadConfig } = await import('../src/config.js')
      vi.mocked(loadConfig).mockReturnValue({
        defaults: { grant_poll_max_minutes: '15' },
      })
      await driveRun()

      const out = collectedLog()
      expect(out).toContain('up to 15 minutes')
    })

    it('env wins over config for max minutes', async () => {
      const { loadConfig } = await import('../src/config.js')
      vi.mocked(loadConfig).mockReturnValue({
        defaults: { grant_poll_max_minutes: '15' },
      })
      process.env.APES_GRANT_POLL_MAX_MINUTES = '10'
      await driveRun()

      const out = collectedLog()
      expect(out).toContain('up to 10 minutes')
      expect(out).not.toContain('up to 15 minutes')
    })

    it('bogus max-minutes env values are ignored, default 5 applies', async () => {
      process.env.APES_GRANT_POLL_MAX_MINUTES = '-5'
      await driveRun()

      const out = collectedLog()
      expect(out).toContain('up to 5 minutes')
    })
  })

  // ------------------------------------------------------------------------
  // one-shot `ape-shell -c "apes <subcmd>"` self-dispatch shortcut.
  //
  // The 0.9.2 exemption lived only in shell/grant-dispatch.ts (interactive
  // REPL). This suite verifies that runShellMode in commands/run.ts — the
  // code path for `ape-shell -c "<cmd>"` after `rewriteApeShellArgs` has
  // rewritten it to `apes run --shell -- bash -c "<cmd>"` — also short-
  // circuits apes self-invocations without creating a grant.
  //
  // Regression guard for the openclaw polling cascade: without this fix,
  // `ape-shell -c "apes grants status <id> --json"` creates a new grant
  // itself, and every poll of the resulting pending grant creates yet
  // another grant, cascading indefinitely.
  // ------------------------------------------------------------------------
  describe('runShellMode apes self-dispatch shortcut', () => {
    /**
     * Drive runShellMode with a given inner command. Two termination paths:
     *
     * - `expectedExit === 'none'`: the call returns normally. Used by the
     *   self-dispatch tests where `execShellCommand` is called directly and
     *   the helper (a mock) returns normally without throwing.
     * - `expectedExit === <number>`: the call is expected to throw
     *   `CliExit(<number>)`. Used by the "stays gated" tests where the
     *   command falls through to the normal grant flow and exits with the
     *   async exit code.
     */
    async function driveShellMode(
      inner: string,
      expectedExit: number | 'none' = 'none',
    ) {
      const shapes = await import('../src/shapes/index.js')
      // extractShellCommandString pulls out the inner bash -c payload.
      // The default mock returns command.at(-1), which is exactly the
      // inner string when command = ['bash', '-c', inner].
      vi.mocked(shapes.extractShellCommandString).mockReturnValue(inner)

      const { runCommand } = await import('../src/commands/run.js')
      const promise = runCommand.run!({
        rawArgs: ['run', '--shell', '--', 'bash', '-c', inner],
        args: { shell: true, wait: false, approval: 'once' } as any,
      } as any)

      if (expectedExit === 'none')
        await promise
      else
        await expectCliExit(promise, expectedExit)
    }

    it('`ape-shell -c "apes grants status <id>"` bypasses grant flow, execs directly', async () => {
      const shapes = await import('../src/shapes/index.js')
      vi.mocked(shapes.parseShellCommand).mockReturnValue({
        executable: 'apes',
        argv: ['grants', 'status', 'abc-123', '--json'],
        isCompound: false,
        raw: 'apes grants status abc-123 --json',
      } as any)

      const { apiFetch } = await import('../src/http.js')

      await driveShellMode('apes grants status abc-123 --json')

      // Must NOT hit the adapter flow
      expect(shapes.loadOrInstallAdapter).not.toHaveBeenCalled()
      expect(shapes.createShapesGrant).not.toHaveBeenCalled()
      // Must NOT hit the session-grant API calls
      expect(apiFetch).not.toHaveBeenCalled()
      // Must NOT print the async info block
      expect(successSpy.mock.calls.map(c => c.join(' ')).join('\n')).not.toContain('created (pending approval)')

      // Must directly exec bash -c <line>
      const { execFileSync } = await import('node:child_process')
      expect(execFileSync).toHaveBeenCalledWith(
        'bash',
        ['-c', 'apes grants status abc-123 --json'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })

    it('`ape-shell -c "apes grants run <id>"` bypasses grant flow (the bootstrap case)', async () => {
      const shapes = await import('../src/shapes/index.js')
      vi.mocked(shapes.parseShellCommand).mockReturnValue({
        executable: 'apes',
        argv: ['grants', 'run', 'xyz-grant-id'],
        isCompound: false,
        raw: 'apes grants run xyz-grant-id',
      } as any)

      const { apiFetch } = await import('../src/http.js')

      await driveShellMode('apes grants run xyz-grant-id')

      expect(shapes.loadOrInstallAdapter).not.toHaveBeenCalled()
      expect(apiFetch).not.toHaveBeenCalled()

      const { execFileSync } = await import('node:child_process')
      expect(execFileSync).toHaveBeenCalledWith(
        'bash',
        ['-c', 'apes grants run xyz-grant-id'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })

    it('`ape-shell -c "apes whoami"` bypasses grant flow', async () => {
      const shapes = await import('../src/shapes/index.js')
      vi.mocked(shapes.parseShellCommand).mockReturnValue({
        executable: 'apes',
        argv: ['whoami'],
        isCompound: false,
        raw: 'apes whoami',
      } as any)

      const { apiFetch } = await import('../src/http.js')

      await driveShellMode('apes whoami')

      expect(shapes.loadOrInstallAdapter).not.toHaveBeenCalled()
      expect(apiFetch).not.toHaveBeenCalled()
    })

    it('`ape-shell -c "apes adapter install curl"` bypasses grant flow', async () => {
      const shapes = await import('../src/shapes/index.js')
      vi.mocked(shapes.parseShellCommand).mockReturnValue({
        executable: 'apes',
        argv: ['adapter', 'install', 'curl'],
        isCompound: false,
        raw: 'apes adapter install curl',
      } as any)

      const { apiFetch } = await import('../src/http.js')

      await driveShellMode('apes adapter install curl')

      expect(shapes.loadOrInstallAdapter).not.toHaveBeenCalled()
      expect(apiFetch).not.toHaveBeenCalled()
    })

    it('`ape-shell -c "apes run -- echo hi"` STAYS gated (run is in blocklist)', async () => {
      const shapes = await import('../src/shapes/index.js')
      // The parseShellCommand for `apes run -- echo hi` returns executable=apes,
      // argv starting with 'run'. `run` is in APES_GATED_SUBCOMMANDS → falls
      // through to the normal flow.
      vi.mocked(shapes.parseShellCommand).mockReturnValue({
        executable: 'apes',
        argv: ['run', '--', 'echo', 'hi'],
        isCompound: false,
        raw: 'apes run -- echo hi',
      } as any)
      // No adapter for `apes` registered → adapter path returns false
      vi.mocked(shapes.loadOrInstallAdapter).mockResolvedValue(null)

      const { apiFetch } = await import('../src/http.js')
      vi.mocked(apiFetch)
        .mockResolvedValueOnce({ data: [] } as any) // session grant lookup
        .mockResolvedValueOnce({ id: 'gated-grant', status: 'pending' } as any) // create

      await driveShellMode('apes run -- echo hi', 75)

      // Should NOT have short-circuited — adapter path was attempted
      expect(shapes.loadOrInstallAdapter).toHaveBeenCalled()
      // Session-grant path was taken, pending info printed
      expect(apiFetch).toHaveBeenCalled()
      const out = successSpy.mock.calls.map(c => c.join(' ')).join('\n')
      expect(out).toContain('gated-grant')
    })

    it('`ape-shell -c "apes fetch https://example.com"` STAYS gated', async () => {
      const shapes = await import('../src/shapes/index.js')
      vi.mocked(shapes.parseShellCommand).mockReturnValue({
        executable: 'apes',
        argv: ['fetch', 'https://example.com'],
        isCompound: false,
        raw: 'apes fetch https://example.com',
      } as any)
      vi.mocked(shapes.loadOrInstallAdapter).mockResolvedValue(null)

      const { apiFetch } = await import('../src/http.js')
      vi.mocked(apiFetch)
        .mockResolvedValueOnce({ data: [] } as any)
        .mockResolvedValueOnce({ id: 'gated-fetch', status: 'pending' } as any)

      await driveShellMode('apes fetch https://example.com', 75)

      expect(apiFetch).toHaveBeenCalled()
    })

    it('`ape-shell -c "apes mcp server"` STAYS gated', async () => {
      const shapes = await import('../src/shapes/index.js')
      vi.mocked(shapes.parseShellCommand).mockReturnValue({
        executable: 'apes',
        argv: ['mcp', 'server'],
        isCompound: false,
        raw: 'apes mcp server',
      } as any)
      vi.mocked(shapes.loadOrInstallAdapter).mockResolvedValue(null)

      const { apiFetch } = await import('../src/http.js')
      vi.mocked(apiFetch)
        .mockResolvedValueOnce({ data: [] } as any)
        .mockResolvedValueOnce({ id: 'gated-mcp', status: 'pending' } as any)

      await driveShellMode('apes mcp server', 75)

      expect(apiFetch).toHaveBeenCalled()
    })

    it('`ape-shell -c "apes whoami | grep alice"` (compound) does NOT self-dispatch', async () => {
      const shapes = await import('../src/shapes/index.js')
      vi.mocked(shapes.parseShellCommand).mockReturnValue({
        executable: 'apes',
        argv: ['whoami', '|', 'grep', 'alice'],
        isCompound: true, // the key signal
        raw: 'apes whoami | grep alice',
      } as any)
      vi.mocked(shapes.loadOrInstallAdapter).mockResolvedValue(null)

      const { apiFetch } = await import('../src/http.js')
      vi.mocked(apiFetch)
        .mockResolvedValueOnce({ data: [] } as any)
        .mockResolvedValueOnce({ id: 'compound-grant', status: 'pending' } as any)

      await driveShellMode('apes whoami | grep alice', 75)

      // Compound short-circuits the self-dispatch, falls through to
      // the normal session-grant path
      expect(apiFetch).toHaveBeenCalled()
    })

    it('`ape-shell -c "curl example.com"` (non-apes) does NOT self-dispatch', async () => {
      const shapes = await import('../src/shapes/index.js')
      vi.mocked(shapes.parseShellCommand).mockReturnValue({
        executable: 'curl',
        argv: ['example.com'],
        isCompound: false,
        raw: 'curl example.com',
      } as any)
      vi.mocked(shapes.loadOrInstallAdapter).mockResolvedValue({} as any)
      vi.mocked(shapes.resolveCommand).mockResolvedValue(makeResolved('curl example.com'))
      vi.mocked(shapes.findExistingGrant).mockResolvedValue(null)
      vi.mocked(shapes.createShapesGrant).mockResolvedValue({ id: 'curl-grant' } as any)

      await driveShellMode('curl example.com', 75)

      // Adapter flow was attempted (not short-circuited)
      expect(shapes.loadOrInstallAdapter).toHaveBeenCalled()
      expect(shapes.createShapesGrant).toHaveBeenCalled()
    })
  })

  // ------------------------------------------------------------------------
  // one-shot `ape-shell -c "sudo <cmd>"` sudo rejection.
  //
  // The REPL path in shell/grant-dispatch.ts already short-circuits leading
  // sudo with a hint to `apes run --as root -- <cmd>`. The one-shot path
  // through runShellMode in commands/run.ts — which is what openclaw's
  // bash-tools.exec hits when it has SHELL=ape-shell — missed the check and
  // fell through to the generic session-grant flow, producing an opaque
  // "sudo: a password is required" error with no guidance.
  //
  // These tests lock the symmetric behavior in: `apes run --shell --
  // bash -c "sudo <cmd>"` throws a CliError with the same hint the REPL
  // produces.
  // ------------------------------------------------------------------------
  describe('runShellMode sudo rejection', () => {
    async function driveShellModeExpectError(inner: string, pattern: RegExp) {
      const shapes = await import('../src/shapes/index.js')
      vi.mocked(shapes.extractShellCommandString).mockReturnValue(inner)
      const { runCommand } = await import('../src/commands/run.js')
      await expect(runCommand.run!({
        rawArgs: ['run', '--shell', '--', 'bash', '-c', inner],
        args: { shell: true, wait: false, approval: 'once' } as any,
      } as any)).rejects.toThrow(pattern)
    }

    it('`ape-shell -c "sudo chown root:wheel /tmp/x"` throws with apes run --as root hint', async () => {
      const shapes = await import('../src/shapes/index.js')
      vi.mocked(shapes.parseShellCommand).mockReturnValue({
        executable: 'sudo',
        argv: ['chown', 'root:wheel', '/tmp/x'],
        isCompound: false,
        raw: 'sudo chown root:wheel /tmp/x',
      } as any)

      await driveShellModeExpectError(
        'sudo chown root:wheel /tmp/x',
        /apes run --as root -- chown root:wheel \/tmp\/x/,
      )

      // Must short-circuit before the adapter or session-grant path.
      expect(shapes.loadOrInstallAdapter).not.toHaveBeenCalled()
    })

    it('`ape-shell -c "sudo"` (bare) throws with the generic hint', async () => {
      const shapes = await import('../src/shapes/index.js')
      vi.mocked(shapes.parseShellCommand).mockReturnValue({
        executable: 'sudo',
        argv: [],
        isCompound: false,
        raw: 'sudo',
      } as any)

      await driveShellModeExpectError('sudo', /apes run --as root -- <cmd>/)
    })

    it('`ape-shell -c "echo foo | sudo tee /etc/x"` (compound) does NOT short-circuit', async () => {
      const shapes = await import('../src/shapes/index.js')
      vi.mocked(shapes.extractShellCommandString).mockReturnValue('echo foo | sudo tee /etc/x')
      vi.mocked(shapes.parseShellCommand).mockReturnValue({
        executable: 'echo',
        argv: ['foo', '|', 'sudo', 'tee', '/etc/x'],
        isCompound: true,
        raw: 'echo foo | sudo tee /etc/x',
      } as any)
      vi.mocked(shapes.loadOrInstallAdapter).mockResolvedValue(null)

      const { apiFetch } = await import('../src/http.js')
      vi.mocked(apiFetch)
        .mockResolvedValueOnce({ data: [] } as any)
        .mockResolvedValueOnce({ id: 'compound-sudo-grant', status: 'pending' } as any)

      // Compound lines fall through to the normal session-grant path.
      const { runCommand } = await import('../src/commands/run.js')
      await expectCliExit(runCommand.run!({
        rawArgs: ['run', '--shell', '--', 'bash', '-c', 'echo foo | sudo tee /etc/x'],
        args: { shell: true, wait: false, approval: 'once' } as any,
      } as any), 75)

      expect(apiFetch).toHaveBeenCalled()
    })
  })

  // ------------------------------------------------------------------------
  // execShellCommand env strip — mirrors the Finding 4 fix from pty-bridge.ts
  // for the one-shot `ape-shell -c` path. Without this, nested `apes` in the
  // bash child inherits APES_SHELL_WRAPPER=1 and hits "unsupported invocation".
  // ------------------------------------------------------------------------
  describe('execShellCommand APES_SHELL_WRAPPER env strip', () => {
    afterEach(() => {
      delete process.env.APES_SHELL_WRAPPER
    })

    it('strips APES_SHELL_WRAPPER from the bash child env when self-dispatching', async () => {
      process.env.APES_SHELL_WRAPPER = '1'
      const shapes = await import('../src/shapes/index.js')
      vi.mocked(shapes.parseShellCommand).mockReturnValue({
        executable: 'apes',
        argv: ['whoami'],
        isCompound: false,
        raw: 'apes whoami',
      } as any)
      vi.mocked(shapes.extractShellCommandString).mockReturnValue('apes whoami')

      const { runCommand } = await import('../src/commands/run.js')
      await runCommand.run!({
        rawArgs: ['run', '--shell', '--', 'bash', '-c', 'apes whoami'],
        args: { shell: true, wait: false, approval: 'once' } as any,
      } as any)

      const { execFileSync } = await import('node:child_process')
      expect(execFileSync).toHaveBeenCalled()
      const callArgs = vi.mocked(execFileSync).mock.calls[0]!
      const opts = callArgs[2] as { env?: Record<string, string | undefined> }
      expect(opts.env).toBeDefined()
      expect(opts.env!.APES_SHELL_WRAPPER).toBeUndefined()
      // Other env vars still there
      expect(opts.env!.PATH).toBeDefined()
    })

    it('strips APES_SHELL_WRAPPER from escapes pipe in runAudienceMode --wait mode', async () => {
      process.env.APES_SHELL_WRAPPER = '1'
      const { apiFetch } = await import('../src/http.js')
      vi.mocked(apiFetch)
        .mockResolvedValueOnce({ id: 'escapes-grant', status: 'pending' } as any)
        .mockResolvedValueOnce({ status: 'approved' } as any)
        .mockResolvedValueOnce({ authz_jwt: 'jwt-tok' } as any)

      const { runCommand } = await import('../src/commands/run.js')
      await runCommand.run!({
        rawArgs: ['run', 'escapes', 'mount-nfs', '--wait'],
        args: { shell: false, wait: true, approval: 'once', 'escapes-path': 'escapes' } as any,
      } as any)

      const { execFileSync } = await import('node:child_process')
      expect(execFileSync).toHaveBeenCalledWith(
        'escapes',
        ['--grant', 'jwt-tok', '--', 'mount-nfs'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
      const callArgs = vi.mocked(execFileSync).mock.calls[0]!
      const opts = callArgs[2] as { env?: Record<string, string | undefined> }
      expect(opts.env).toBeDefined()
      expect(opts.env!.APES_SHELL_WRAPPER).toBeUndefined()
    })
  })

  // ------------------------------------------------------------------------
  // Async-default exit code — 0.10.0 changed the default from 0 to 75
  // (EX_TEMPFAIL from sysexits.h) so AI agent wrappers receive the pending
  // state as a structural `failed` tool-result status instead of success.
  //
  // Override via APES_ASYNC_EXIT_CODE env var or config.toml
  // `defaults.async_exit_code`. Set to 0 to restore pre-0.10.0 behaviour.
  // Bogus values (non-numeric, out of 0–255 range) fall back to 75.
  //
  // --wait mode is unaffected — the blocking path always returns 0 on
  // successful exec, regardless of APES_ASYNC_EXIT_CODE.
  // ------------------------------------------------------------------------
  describe('async exit code (APES_ASYNC_EXIT_CODE)', () => {
    async function driveAsyncExit(expectedCode: number) {
      const { apiFetch } = await import('../src/http.js')
      vi.mocked(apiFetch).mockResolvedValueOnce({ id: 'exit-test', status: 'pending' } as any)

      const { runCommand } = await import('../src/commands/run.js')
      await expectCliExit(
        runCommand.run!({
          rawArgs: ['run', 'escapes', 'mount-nfs'],
          args: { shell: false, wait: false, approval: 'once' } as any,
        } as any),
        expectedCode,
      )
    }

    afterEach(() => {
      delete process.env.APES_ASYNC_EXIT_CODE
    })

    it('default: throws CliExit(75) = EX_TEMPFAIL', async () => {
      await driveAsyncExit(75)
    })

    it('APES_ASYNC_EXIT_CODE=0 restores legacy exit-0 behaviour', async () => {
      process.env.APES_ASYNC_EXIT_CODE = '0'
      await driveAsyncExit(0)
    })

    it('APES_ASYNC_EXIT_CODE=2 respects a custom numeric override', async () => {
      process.env.APES_ASYNC_EXIT_CODE = '2'
      await driveAsyncExit(2)
    })

    it('APES_ASYNC_EXIT_CODE=255 accepts the maximum POSIX exit code', async () => {
      process.env.APES_ASYNC_EXIT_CODE = '255'
      await driveAsyncExit(255)
    })

    it('APES_ASYNC_EXIT_CODE=256 (out of range) falls back to 75', async () => {
      process.env.APES_ASYNC_EXIT_CODE = '256'
      await driveAsyncExit(75)
    })

    it('APES_ASYNC_EXIT_CODE=-1 (negative) falls back to 75', async () => {
      process.env.APES_ASYNC_EXIT_CODE = '-1'
      await driveAsyncExit(75)
    })

    it('APES_ASYNC_EXIT_CODE=not-a-number (bogus) falls back to 75', async () => {
      process.env.APES_ASYNC_EXIT_CODE = 'not-a-number'
      await driveAsyncExit(75)
    })

    it('APES_ASYNC_EXIT_CODE empty string falls back to 75', async () => {
      process.env.APES_ASYNC_EXIT_CODE = ''
      await driveAsyncExit(75)
    })

    it('config.toml defaults.async_exit_code override respected when env unset', async () => {
      const { loadConfig } = await import('../src/config.js')
      vi.mocked(loadConfig).mockReturnValue({ defaults: { async_exit_code: '42' } })
      await driveAsyncExit(42)
    })

    it('APES_ASYNC_EXIT_CODE env wins over config.toml async_exit_code', async () => {
      const { loadConfig } = await import('../src/config.js')
      vi.mocked(loadConfig).mockReturnValue({ defaults: { async_exit_code: '42' } })
      process.env.APES_ASYNC_EXIT_CODE = '7'
      await driveAsyncExit(7)
    })

    it('--wait mode is unaffected — returns 0 on successful exec even with APES_ASYNC_EXIT_CODE=99', async () => {
      process.env.APES_ASYNC_EXIT_CODE = '99'
      const { apiFetch } = await import('../src/http.js')
      vi.mocked(apiFetch)
        .mockResolvedValueOnce({ id: 'sync-test', status: 'pending' } as any)
        .mockResolvedValueOnce({ status: 'approved' } as any)
        .mockResolvedValueOnce({ authz_jwt: 'jwt-sync' } as any)

      const { execFileSync } = await import('node:child_process')
      vi.mocked(execFileSync).mockReturnValue(Buffer.from(''))

      const { runCommand } = await import('../src/commands/run.js')
      // --wait mode: runCommand.run returns normally (no CliExit thrown)
      // because the blocking path runs execFileSync to completion and the
      // async exit code is never consulted.
      await runCommand.run!({
        rawArgs: ['run', 'escapes', 'mount-nfs', '--wait'],
        args: { shell: false, wait: true, approval: 'once', 'escapes-path': 'escapes' } as any,
      } as any)

      expect(execFileSync).toHaveBeenCalled()
    })
  })
})
