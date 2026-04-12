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
  beforeEach(async () => {
    vi.clearAllMocks()
    const { loadAuth } = await import('../src/config.js')
    vi.mocked(loadAuth).mockReturnValue(fakeAuth as any)
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('returns denied when not logged in', async () => {
    const { loadAuth } = await import('../src/config.js')
    vi.mocked(loadAuth).mockReturnValue(null)

    const { requestGrantForShellLine } = await import('../src/shell/grant-dispatch.js')
    const result = await requestGrantForShellLine('ls', { targetHost: 'host.test' })

    expect(result).toEqual({ kind: 'denied', reason: expect.stringContaining('Not logged in') })
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
})
