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
    expect(verifyAndExecute).toHaveBeenCalledWith('jwt-token', fakeResolved)
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
})
