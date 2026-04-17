import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock every dependency so tests run without network / filesystem / auth state.
// We verify the dispatch logic of `apes grants run <id>`: status gating,
// shapes-grant re-resolution, escapes pipe, legacy shell-session rejection,
// unknown audience handling, and resolve-failure surfacing.

vi.mock('../src/config.js', () => ({
  loadAuth: vi.fn(() => ({ email: 'alice@example.com', idp: 'http://idp.test', expires_at: Date.now() / 1000 + 3600 })),
  getIdpUrl: vi.fn(() => 'http://idp.test'),
}))
vi.mock('../src/http.js', () => ({
  apiFetch: vi.fn(),
  getGrantsEndpoint: vi.fn(async () => 'http://idp.test/api/grants'),
  ApiError: class extends Error {},
}))
vi.mock('../src/shapes/index.js', () => ({
  resolveFromGrant: vi.fn(),
  fetchGrantToken: vi.fn(),
  verifyAndExecute: vi.fn(),
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

  it('executes an approved shapes grant via verifyAndExecute', async () => {
    const { apiFetch } = await import('../src/http.js')
    const { resolveFromGrant, fetchGrantToken, verifyAndExecute } = await import('../src/shapes/index.js')

    const grant = {
      id: 'grant-abc',
      type: 'cli',
      status: 'approved',
      requester: 'alice@example.com',
      owner: 'alice@example.com',
      request: {
        command: ['curl', 'https://example.com'],
        audience: 'shapes',
        authorization_details: [{ type: 'openape_cli' }],
        execution_context: { adapter_digest: 'sha-local' },
      },
    }
    vi.mocked(apiFetch).mockResolvedValueOnce(grant as any)
    const fakeResolved = { executable: 'curl', commandArgv: ['https://example.com'] }
    vi.mocked(resolveFromGrant).mockResolvedValueOnce(fakeResolved as any)
    vi.mocked(fetchGrantToken).mockResolvedValueOnce('jwt-token')
    vi.mocked(verifyAndExecute).mockResolvedValueOnce(undefined)

    await invoke('grant-abc')

    expect(resolveFromGrant).toHaveBeenCalledWith(grant)
    expect(fetchGrantToken).toHaveBeenCalledWith('http://idp.test', 'grant-abc')
    expect(verifyAndExecute).toHaveBeenCalledWith('jwt-token', fakeResolved, 'grant-abc')
  })

  it('executes an approved escapes grant via the escapes binary', async () => {
    const { apiFetch } = await import('../src/http.js')
    const { execFileSync } = await import('node:child_process')
    const { verifyAndExecute } = await import('../src/shapes/index.js')

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
    expect(verifyAndExecute).not.toHaveBeenCalled()
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

  it('surfaces resolve failures without calling verifyAndExecute', async () => {
    const { apiFetch } = await import('../src/http.js')
    const { resolveFromGrant, verifyAndExecute } = await import('../src/shapes/index.js')

    vi.mocked(apiFetch).mockResolvedValueOnce({
      id: 'grant-mismatch',
      type: 'cli',
      status: 'approved',
      requester: 'a',
      owner: 'a',
      request: {
        command: ['curl', 'https://example.com'],
        audience: 'shapes',
        authorization_details: [{ type: 'openape_cli' }],
        execution_context: { adapter_digest: 'sha-old' },
      },
    } as any)
    vi.mocked(resolveFromGrant).mockRejectedValueOnce(new Error('digest mismatch'))

    await expectCliError(invoke('grant-mismatch'), /Cannot re-resolve grant.*digest mismatch/)
    expect(verifyAndExecute).not.toHaveBeenCalled()
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
      return {
        id,
        type: 'cli',
        status: 'pending',
        requester: 'alice@example.com',
        owner: 'alice@example.com',
        request: {
          command: ['curl', 'https://example.com'],
          audience: 'shapes',
          authorization_details: [{ type: 'openape_cli' }],
          execution_context: { adapter_digest: 'sha-local' },
        },
      }
    }

    function approvedGrant(id: string) {
      return { ...pendingGrant(id), status: 'approved' }
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
      const { resolveFromGrant, fetchGrantToken, verifyAndExecute } = await import('../src/shapes/index.js')

      // First fetch: pending. Second fetch (after poll): approved.
      vi.mocked(apiFetch)
        .mockResolvedValueOnce(pendingGrant('grant-wait-1') as any)
        .mockResolvedValueOnce(approvedGrant('grant-wait-1') as any)

      vi.mocked(pollGrantUntilResolved).mockResolvedValueOnce({ kind: 'approved' })
      vi.mocked(resolveFromGrant).mockResolvedValueOnce({ executable: 'curl' } as any)
      vi.mocked(fetchGrantToken).mockResolvedValueOnce('jwt-tok')
      vi.mocked(verifyAndExecute).mockResolvedValueOnce(undefined)

      await invoke('grant-wait-1', { wait: true })

      expect(pollGrantUntilResolved).toHaveBeenCalledWith('http://idp.test', 'grant-wait-1')
      expect(verifyAndExecute).toHaveBeenCalledWith('jwt-tok', { executable: 'curl' }, 'grant-wait-1')
    })

    it('with --wait: pending → poll → denied → CliError', async () => {
      const { apiFetch } = await import('../src/http.js')
      const { pollGrantUntilResolved } = await import('../src/grant-poll.js')
      const { verifyAndExecute } = await import('../src/shapes/index.js')

      vi.mocked(apiFetch).mockResolvedValueOnce(pendingGrant('grant-wait-denied') as any)
      vi.mocked(pollGrantUntilResolved).mockResolvedValueOnce({ kind: 'terminal', status: 'denied' })

      await expectCliError(invoke('grant-wait-denied', { wait: true }), /resolved to denied/)
      expect(verifyAndExecute).not.toHaveBeenCalled()
    })

    it('with --wait: pending → poll → revoked → CliError', async () => {
      const { apiFetch } = await import('../src/http.js')
      const { pollGrantUntilResolved } = await import('../src/grant-poll.js')
      const { verifyAndExecute } = await import('../src/shapes/index.js')

      vi.mocked(apiFetch).mockResolvedValueOnce(pendingGrant('grant-wait-revoked') as any)
      vi.mocked(pollGrantUntilResolved).mockResolvedValueOnce({ kind: 'terminal', status: 'revoked' })

      await expectCliError(invoke('grant-wait-revoked', { wait: true }), /resolved to revoked/)
      expect(verifyAndExecute).not.toHaveBeenCalled()
    })

    it('with --wait: pending → poll → timeout → CliError mentioning max minutes', async () => {
      const { apiFetch } = await import('../src/http.js')
      const { pollGrantUntilResolved, getPollMaxMinutes } = await import('../src/grant-poll.js')
      const { verifyAndExecute } = await import('../src/shapes/index.js')

      vi.mocked(apiFetch).mockResolvedValueOnce(pendingGrant('grant-wait-timeout') as any)
      vi.mocked(pollGrantUntilResolved).mockResolvedValueOnce({ kind: 'timeout' })
      vi.mocked(getPollMaxMinutes).mockReturnValue(5)

      await expectCliError(invoke('grant-wait-timeout', { wait: true }), /timed out after 5 minutes/)
      expect(verifyAndExecute).not.toHaveBeenCalled()
    })

    it('with --wait: already-approved grant dispatches immediately, no poll', async () => {
      const { apiFetch } = await import('../src/http.js')
      const { pollGrantUntilResolved } = await import('../src/grant-poll.js')
      const { resolveFromGrant, fetchGrantToken, verifyAndExecute } = await import('../src/shapes/index.js')

      vi.mocked(apiFetch).mockResolvedValueOnce(approvedGrant('grant-already-approved') as any)
      vi.mocked(resolveFromGrant).mockResolvedValueOnce({ executable: 'curl' } as any)
      vi.mocked(fetchGrantToken).mockResolvedValueOnce('jwt-tok')
      vi.mocked(verifyAndExecute).mockResolvedValueOnce(undefined)

      await invoke('grant-already-approved', { wait: true })

      // --wait is harmless on an already-approved grant: it only triggers
      // the poll loop on pending status, not on approved.
      expect(pollGrantUntilResolved).not.toHaveBeenCalled()
      expect(verifyAndExecute).toHaveBeenCalled()
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
