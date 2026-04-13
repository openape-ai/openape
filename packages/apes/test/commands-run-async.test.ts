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

describe('commands/run async default', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>
  let infoSpy: ReturnType<typeof vi.spyOn>
  let successSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
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
      await runCommand.run!({
        rawArgs: ['run', '--shell', '--', 'bash', '-c', 'curl https://example.com'],
        args: { shell: true, wait: false, approval: 'once' } as any,
      } as any)

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
      await runCommand.run!({
        rawArgs: ['run', '--shell', '--', 'bash', '-c', 'echo a | echo b'],
        args: { shell: true, wait: false, approval: 'once' } as any,
      } as any)

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
      await runCommand.run!({
        rawArgs: ['run', '--', 'whoami'],
        args: { shell: false, wait: false, approval: 'once' } as any,
      } as any)

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
      await runCommand.run!({
        rawArgs: ['run', 'escapes', 'mount-nfs'],
        args: { shell: false, wait: false, approval: 'once', 'escapes-path': 'escapes' } as any,
      } as any)

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
})
