import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock every dependency so tests run without network / filesystem / auth state.
// We verify the dispatch logic of `apes grants run <id>`: status gating,
// program grants re-authorized at the IdP, escapes pipe, legacy shell-session
// rejection, unknown audience handling, and changed-program refusal.

vi.mock('../src/config.js', () => ({
  loadAuth: vi.fn(() => ({ email: 'alice@example.com', idp: 'http://idp.test', expires_at: Date.now() / 1000 + 3600 })),
  getIdpUrl: vi.fn(() => 'http://idp.test'),
}))
vi.mock('../src/http.js', () => ({
  apiFetch: vi.fn(),
  getGrantsEndpoint: vi.fn(async () => 'http://idp.test/api/grants'),
  ApiError: class extends Error {},
}))
vi.mock('../src/authorization/program.js', async () => ({
  ...(await vi.importActual<typeof import('../src/authorization/program.js')>('../src/authorization/program.js')),
  locateProgram: vi.fn(async (name: string) => ({ path: `/usr/bin/${name}`, name, sha256: 'a'.repeat(64) })),
  authorizeProgramCall: vi.fn(),
}))
vi.mock('../src/authorization/execute.js', () => ({
  executeProgramCall: vi.fn(),
}))
vi.mock('../src/grant-poll.js', () => ({
  // Mock the entire grant-poll module so the --wait tests can control
  // the polling outcome deterministically instead of actually polling
  // against a fake IdP. The real helper lives in src/grant-poll.ts and
  // has its own unit tests elsewhere.
  pollGrantUntilResolved: vi.fn(),
  getPollIntervalSeconds: vi.fn(() => 10),
  getPollMaxMinutes: vi.fn(() => 5),
}))
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}))

async function invoke(id = 'grant-abc', extra: Record<string, unknown> = {}) {
  const { runGrantCommand } = await import('../src/commands/grants/run.js')
  const runFn = (runGrantCommand as unknown as { run: (ctx: { args: Record<string, unknown> }) => Promise<void> }).run
  return runFn({ args: { id, 'escapes-path': 'escapes', ...extra } })
}

/** A program grant as the IdP records it: execution_context names the program and its file hash. */
function programGrant(id: string, status: string, programSha256 = 'a'.repeat(64)) {
  return {
    id,
    type: 'cli',
    status,
    requester: 'alice@example.com',
    owner: 'alice@example.com',
    request: {
      command: ['curl', 'https://example.com'],
      audience: 'shapes',
      authorization_details: [{ type: 'openape_cli' }],
      execution_context: { argv: ['curl', 'https://example.com'], program_sha256: programSha256 },
    },
  }
}

async function expectCliError(p: Promise<unknown>, matcher: RegExp | string) {
  try {
    await p
    throw new Error('expected CliError to be thrown')
  }
  catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (matcher instanceof RegExp)
      expect(message).toMatch(matcher)
    else
      expect(message).toContain(matcher)
  }
}

describe('apes grants run <id>', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('runs an approved program grant only after the IdP authorizes the call again', async () => {
    const { apiFetch } = await import('../src/http.js')
    const { locateProgram, authorizeProgramCall } = await import('../src/authorization/program.js')
    const { executeProgramCall } = await import('../src/authorization/execute.js')

    vi.mocked(apiFetch).mockResolvedValueOnce(programGrant('grant-abc', 'approved') as any)
    vi.mocked(authorizeProgramCall).mockResolvedValueOnce({ kind: 'authorized', grantId: 'grant-abc', token: 'jwt-token', claims: {} as any })

    await invoke('grant-abc')

    expect(locateProgram).toHaveBeenCalledWith('curl')
    const call = { program: { path: '/usr/bin/curl', name: 'curl', sha256: 'a'.repeat(64) }, argv: ['https://example.com'] }
    expect(authorizeProgramCall).toHaveBeenCalledWith(call, expect.objectContaining({ idp: 'http://idp.test', subject: 'alice@example.com', wait: false }))
    expect(executeProgramCall).toHaveBeenCalledWith(call)
  })

  it('executes an approved escapes grant via the escapes binary', async () => {
    const { apiFetch } = await import('../src/http.js')
    const { execFileSync } = await import('node:child_process')
    const { executeProgramCall } = await import('../src/authorization/execute.js')

    const grant = {
      id: 'grant-esc',
      type: 'escapes',
      status: 'approved',
      requester: 'alice@example.com',
      owner: 'alice@example.com',
      request: {
        command: ['mount-nfs'],
        audience: 'escapes',
      },
    }
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(grant as any)
      .mockResolvedValueOnce({ authz_jwt: 'tok' } as any)

    await invoke('grant-esc')

    expect(execFileSync).toHaveBeenCalledWith(
      'escapes',
      ['--grant', 'tok', '--', 'mount-nfs'],
      { stdio: 'inherit' },
    )
    expect(executeProgramCall).not.toHaveBeenCalled()
  })

  it('rejects an ape-shell session grant with a clear error', async () => {
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(apiFetch).mockResolvedValueOnce({
      id: 'grant-shell',
      type: 'cli',
      status: 'approved',
      requester: 'a',
      owner: 'a',
      request: { audience: 'ape-shell', command: ['ls'] },
    } as any)

    await expectCliError(invoke('grant-shell'), 'cannot be re-executed')
  })

  it('errors on a pending grant and includes the approval URL', async () => {
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(apiFetch).mockResolvedValueOnce({
      id: 'grant-pending',
      type: 'cli',
      status: 'pending',
      requester: 'a',
      owner: 'a',
      request: { audience: 'shapes', command: ['curl'] },
    } as any)

    await expectCliError(invoke('grant-pending'), 'grant-approval?grant_id=grant-pending')
  })

  it('errors on a denied grant', async () => {
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(apiFetch).mockResolvedValueOnce({
      id: 'grant-denied',
      type: 'cli',
      status: 'denied',
      requester: 'a',
      owner: 'a',
      request: { audience: 'shapes', command: ['curl'] },
    } as any)

    await expectCliError(invoke('grant-denied'), 'denied')
  })

  it('errors on a used grant', async () => {
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(apiFetch).mockResolvedValueOnce({
      id: 'grant-used',
      type: 'cli',
      status: 'used',
      requester: 'a',
      owner: 'a',
      request: { audience: 'shapes', command: ['curl'] },
    } as any)

    await expectCliError(invoke('grant-used'), 'already been used')
  })

  it('refuses a program that changed since the request and one the IdP does not authorize', async () => {
    const { apiFetch } = await import('../src/http.js')
    const { authorizeProgramCall, AuthorizationRefusedError } = await import('../src/authorization/program.js')
    const { executeProgramCall } = await import('../src/authorization/execute.js')

    vi.mocked(apiFetch).mockResolvedValueOnce(programGrant('grant-changed', 'approved', 'b'.repeat(64)) as any)
    await expectCliError(invoke('grant-changed'), /changed since grant grant-changed was requested/)
    expect(authorizeProgramCall).not.toHaveBeenCalled()

    vi.mocked(apiFetch).mockResolvedValueOnce(programGrant('grant-revoked', 'approved') as any)
    vi.mocked(authorizeProgramCall).mockRejectedValueOnce(new AuthorizationRefusedError('revoked', 'grant-revoked'))
    await expectCliError(invoke('grant-revoked'), 'Grant grant-revoked revoked')

    vi.mocked(apiFetch).mockResolvedValueOnce(programGrant('grant-other', 'approved') as any)
    vi.mocked(authorizeProgramCall).mockResolvedValueOnce({ kind: 'pending', grantId: 'grant-new', approvalUrl: 'http://idp.test/grant-approval?grant_id=grant-new' })
    await expectCliError(invoke('grant-other'), /does not authorize this command here; request grant-new awaits approval/)

    expect(executeProgramCall).not.toHaveBeenCalled()
  })

  it('errors on unknown audience with no openape_cli detail', async () => {
    const { apiFetch } = await import('../src/http.js')
    vi.mocked(apiFetch).mockResolvedValueOnce({
      id: 'grant-weird',
      type: 'cli',
      status: 'approved',
      requester: 'a',
      owner: 'a',
      request: { audience: 'weird', command: ['foo'], authorization_details: [] },
    } as any)

    await expectCliError(invoke('grant-weird'), 'unsupported audience')
  })

  // --------------------------------------------------------------------
  // --wait flag — CLI-side polling loop that keeps the subprocess alive
  // until the grant resolves. This is the pattern 0.10.1 agent-mode text
  // recommends: one tool call, the CLI handles the wait, the agent only
  // sees the final state.
  // --------------------------------------------------------------------
  describe('--wait flag', () => {
    function pendingGrant(id: string) {
      return programGrant(id, 'pending')
    }

    function approvedGrant(id: string) {
      return programGrant(id, 'approved')
    }

    it('without --wait: pending grant still errors immediately (regression guard)', async () => {
      const { apiFetch } = await import('../src/http.js')
      const { pollGrantUntilResolved } = await import('../src/grant-poll.js')
      vi.mocked(apiFetch).mockResolvedValueOnce(pendingGrant('grant-pending') as any)

      await expectCliError(invoke('grant-pending'), /still pending.*grant-approval/)
      // pollGrantUntilResolved must NOT have been called without --wait
      expect(pollGrantUntilResolved).not.toHaveBeenCalled()
    })

    it('with --wait: pending → poll → approved → dispatch shapes grant', async () => {
      const { apiFetch } = await import('../src/http.js')
      const { pollGrantUntilResolved } = await import('../src/grant-poll.js')
      const { authorizeProgramCall } = await import('../src/authorization/program.js')
      const { executeProgramCall } = await import('../src/authorization/execute.js')

      // First fetch: pending. Second fetch (after poll): approved.
      vi.mocked(apiFetch)
        .mockResolvedValueOnce(pendingGrant('grant-wait-1') as any)
        .mockResolvedValueOnce(approvedGrant('grant-wait-1') as any)

      vi.mocked(pollGrantUntilResolved).mockResolvedValueOnce({ kind: 'approved' })
      vi.mocked(authorizeProgramCall).mockResolvedValueOnce({ kind: 'authorized', grantId: 'grant-wait-1', token: 'jwt-tok', claims: {} as any })

      await invoke('grant-wait-1', { wait: true })

      expect(pollGrantUntilResolved).toHaveBeenCalledWith('http://idp.test', 'grant-wait-1')
      expect(executeProgramCall).toHaveBeenCalledWith({ program: expect.objectContaining({ name: 'curl' }), argv: ['https://example.com'] })
    })

    it('with --wait: pending → poll → denied → CliError', async () => {
      const { apiFetch } = await import('../src/http.js')
      const { pollGrantUntilResolved } = await import('../src/grant-poll.js')
      const { executeProgramCall } = await import('../src/authorization/execute.js')

      vi.mocked(apiFetch).mockResolvedValueOnce(pendingGrant('grant-wait-denied') as any)
      vi.mocked(pollGrantUntilResolved).mockResolvedValueOnce({ kind: 'terminal', status: 'denied' })

      await expectCliError(invoke('grant-wait-denied', { wait: true }), /resolved to denied/)
      expect(executeProgramCall).not.toHaveBeenCalled()
    })

    it('with --wait: pending → poll → revoked → CliError', async () => {
      const { apiFetch } = await import('../src/http.js')
      const { pollGrantUntilResolved } = await import('../src/grant-poll.js')
      const { executeProgramCall } = await import('../src/authorization/execute.js')

      vi.mocked(apiFetch).mockResolvedValueOnce(pendingGrant('grant-wait-revoked') as any)
      vi.mocked(pollGrantUntilResolved).mockResolvedValueOnce({ kind: 'terminal', status: 'revoked' })

      await expectCliError(invoke('grant-wait-revoked', { wait: true }), /resolved to revoked/)
      expect(executeProgramCall).not.toHaveBeenCalled()
    })

    it('with --wait: pending → poll → timeout → CliError mentioning max minutes', async () => {
      const { apiFetch } = await import('../src/http.js')
      const { pollGrantUntilResolved, getPollMaxMinutes } = await import('../src/grant-poll.js')
      const { executeProgramCall } = await import('../src/authorization/execute.js')

      vi.mocked(apiFetch).mockResolvedValueOnce(pendingGrant('grant-wait-timeout') as any)
      vi.mocked(pollGrantUntilResolved).mockResolvedValueOnce({ kind: 'timeout' })
      vi.mocked(getPollMaxMinutes).mockReturnValue(5)

      await expectCliError(invoke('grant-wait-timeout', { wait: true }), /timed out after 5 minutes/)
      expect(executeProgramCall).not.toHaveBeenCalled()
    })

    it('with --wait: already-approved grant dispatches immediately, no poll', async () => {
      const { apiFetch } = await import('../src/http.js')
      const { pollGrantUntilResolved } = await import('../src/grant-poll.js')
      const { authorizeProgramCall } = await import('../src/authorization/program.js')
      const { executeProgramCall } = await import('../src/authorization/execute.js')

      vi.mocked(apiFetch).mockResolvedValueOnce(approvedGrant('grant-already-approved') as any)
      vi.mocked(authorizeProgramCall).mockResolvedValueOnce({ kind: 'authorized', grantId: 'grant-already-approved', token: 'jwt-tok', claims: {} as any })

      await invoke('grant-already-approved', { wait: true })

      // --wait is harmless on an already-approved grant: it only triggers
      // the poll loop on pending status, not on approved.
      expect(pollGrantUntilResolved).not.toHaveBeenCalled()
      expect(executeProgramCall).toHaveBeenCalled()
    })

    it('with --wait: pending → approved → dispatch escapes audience', async () => {
      const { apiFetch } = await import('../src/http.js')
      const { pollGrantUntilResolved } = await import('../src/grant-poll.js')

      const pending = {
        id: 'grant-esc',
        type: 'cli',
        status: 'pending',
        requester: 'a',
        owner: 'a',
        request: { audience: 'escapes', command: ['mount-nfs'], authorization_details: [] },
      }
      const approved = { ...pending, status: 'approved' }

      vi.mocked(apiFetch)
        .mockResolvedValueOnce(pending as any) // initial fetch
        .mockResolvedValueOnce(approved as any) // re-fetch after poll
        .mockResolvedValueOnce({ authz_jwt: 'jwt-esc' } as any) // token

      vi.mocked(pollGrantUntilResolved).mockResolvedValueOnce({ kind: 'approved' })

      await invoke('grant-esc', { wait: true })

      const { execFileSync } = await import('node:child_process')
      expect(execFileSync).toHaveBeenCalledWith(
        'escapes',
        ['--grant', 'jwt-esc', '--', 'mount-nfs'],
        expect.objectContaining({ stdio: 'inherit' }),
      )
    })
  })
})
